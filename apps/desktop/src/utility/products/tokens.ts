// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createToken, type ProductStore } from '@taalcut/core';
import type { ProductOperations } from '@taalcut/agent';

export const ProductStoreToken = createToken<ProductStore>('desktop.productStore');
export const ProductServiceToken = createToken<ProductOperations>('desktop.productService');
