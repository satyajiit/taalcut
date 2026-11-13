# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# TransNetV2 rewritten for Core ML (IX2-S6, S8): upstream's PyTorch port (inference-pytorch/transnetv2_pytorch.py,
# MIT) with upstream's weights, the same maths in operations Core ML runs on the GPU and the Neural Engine:
# - the input is float32 [1, 100, 27, 48, 3], 0..255 (the shipped ONNX's input), not uint8;
# - the colour histograms take no bit shifts or scatter_add: a one-hot of each channel's 8 levels, the R x G outer
#   product, then a batched matmul with B's one-hot gives the 512 bins (bin = R*64 + G*8 + B, as upstream). The
#   counts are divided by the pixel count before the L2 normalisation, which is scale-free, so fp16 never overflows;
# - the 101-wide similarity band takes no gather: pad, flatten, pad, reshape (out[t, k] = padded[t, t + k]);
# - every (1,3,3) and dilated (3,1,1) Conv3d of the (2+1)D blocks is a Conv2d (the Neural Engine's own operation;
#   as Conv3d, 29 % of the cost fell to the CPU there).
# Outputs `single` and `many_hot`, [1, 100, 1], after the sigmoid (the ONNX's outputs).
import torch
import torch.nn as nn
import torch.nn.functional as F

T, H, W, WINDOW, HALF = 100, 27, 48, 101, 50


def band(sim: torch.Tensor) -> torch.Tensor:
    """[1, T, T] -> [1, T, WINDOW]: row t holds sim[t, t-50 .. t+50], zero outside."""
    padded = F.pad(sim, [HALF, HALF + 1])  # [1, T, T + WINDOW]
    flat = F.pad(padded.reshape(1, -1), [0, T])  # [1, T * (T + WINDOW + 1)]
    return flat.reshape(1, T, T + WINDOW + 1)[:, :, :WINDOW]


def histograms(frames: torch.Tensor) -> torch.Tensor:
    """[1, T, H, W, 3] 0..255 -> [1, T, 512], L2-normalised 8x8x8 RGB histograms."""
    levels = torch.arange(8, dtype=frames.dtype).view(1, 1, 8)
    q = torch.floor(frames / 32.0).reshape(T, H * W, 3)
    r = (q[:, :, 0:1] == levels).to(frames.dtype)  # [T, P, 8]
    g = (q[:, :, 1:2] == levels).to(frames.dtype)
    b = (q[:, :, 2:3] == levels).to(frames.dtype)
    rg = (r.unsqueeze(3) * g.unsqueeze(2)).reshape(T, H * W, 64)  # [T, P, 64]
    counts = torch.bmm(rg.transpose(1, 2), b).reshape(1, T, 512) / float(H * W)
    return F.normalize(counts, p=2, dim=2)


def conv2d_like(conv3d: nn.Conv3d, weight: torch.Tensor, **options) -> nn.Conv2d:
    """A Conv2d with `weight` (the Conv3d's, one axis dropped) and the Conv3d's bias."""
    conv = nn.Conv2d(weight.shape[1], weight.shape[0], tuple(weight.shape[2:]), bias=conv3d.bias is not None, **options)
    conv.weight.data.copy_(weight)
    if conv3d.bias is not None:
        conv.bias.data.copy_(conv3d.bias.data)
    return conv


class Conv2dSpatial(nn.Module):
    """A (1,3,3) Conv3d on [B, C, T, H, W] as a Conv2d over [B*T, C, H, W]."""

    def __init__(self, conv3d: nn.Conv3d):
        super().__init__()
        self.conv = conv2d_like(conv3d, conv3d.weight.data[:, :, 0], padding=1)  # [out, in, 3, 3]

    def forward(self, x):
        b, c, t, h, w = x.shape
        y = self.conv(x.permute(0, 2, 1, 3, 4).reshape(b * t, c, h, w))
        return y.reshape(b, t, -1, h, w).permute(0, 2, 1, 3, 4)


class Conv2dTemporal(nn.Module):
    """A (3,1,1) dilated Conv3d on [B, C, T, H, W] as a Conv2d over [B, C, T, H*W]."""

    def __init__(self, conv3d: nn.Conv3d):
        super().__init__()
        d = conv3d.dilation[0]
        # [out, in, 3, 1]
        self.conv = conv2d_like(conv3d, conv3d.weight.data[:, :, :, :, 0], dilation=(d, 1), padding=(d, 0))

    def forward(self, x):
        b, c, t, h, w = x.shape
        return self.conv(x.reshape(b, c, t, h * w)).reshape(b, -1, t, h, w)


class TransNetV2CoreML(nn.Module):
    """Upstream's `TransNetV2` (eval mode, its weights loaded), rewritten as above."""

    def __init__(self, net: nn.Module):
        super().__init__()
        self.net = net.eval()
        for stack in net.SDDCNN:
            for block in stack.DDCNN:
                for conv in (block.Conv3D_1, block.Conv3D_2, block.Conv3D_4, block.Conv3D_8):
                    spatial, temporal = conv.layers
                    conv.layers = nn.ModuleList([Conv2dSpatial(spatial), Conv2dTemporal(temporal)])

    def forward(self, frames: torch.Tensor):
        net = self.net
        x = frames.permute(0, 4, 1, 2, 3) / 255.0
        features = []
        for block in net.SDDCNN:
            x = block(x)
            features.append(x)
        x = x.permute(0, 2, 3, 4, 1).reshape(1, T, -1)
        # Frame similarity: mean-pooled block features, projected, cosine band over 101 frames.
        f = torch.cat([torch.mean(y, dim=[3, 4]) for y in features], dim=1).transpose(1, 2)
        f = F.normalize(net.frame_sim_layer.projection(f), p=2, dim=2)
        sim = F.relu(net.frame_sim_layer.fc(band(torch.bmm(f, f.transpose(1, 2)))))
        h = histograms(frames)
        hist = F.relu(net.color_hist_layer.fc(band(torch.bmm(h, h.transpose(1, 2)))))
        x = torch.cat([hist, sim, x], 2)
        x = F.relu(net.fc1(x))
        return torch.sigmoid(net.cls_layer1(x)), torch.sigmoid(net.cls_layer2(x))
