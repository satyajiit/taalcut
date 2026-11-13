---
status: draft
review: native speaker sign-off still required (H8)
source: script.en.md
---

# Roteiro do moderador

Esta tradução é um rascunho. A revisão de uma pessoa falante nativa ainda é necessária. Leia para a pessoa participante as falas entre aspas. Não acrescente uma explicação do produto.

## Antes da sessão

- A pessoa participante cria conteúdo e nunca usou o Taalcut.
- O Mac tem uma conta nova do macOS. Não há mais nada instalado. O Taalcut ainda não está na máquina.
- Você tem o DMG, um celular ou uma pasta com filmagens, e um cartão com o link de um reel.
- O consentimento está assinado antes de gravar. A tela e a voz ficam neste Mac, a menos que a pessoa concorde, no cartão, que uma cópia pode sair.
- Você não está avaliando a pessoa. Você está observando o produto.

## Tempo

- Comece o cronômetro quando a tarefa tiver sido lida. O relógio começa ao terminar a fala entre aspas.
- Pare o cronômetro quando o critério de sucesso for atingido, ou quando o limite estourar, o que acontecer primeiro.
- Não pause o cronômetro enquanto a pessoa lê, hesita ou pergunta algo que você não pode responder.

## Resultados

Registre um resultado por tarefa:

- **success.** O critério de sucesso foi atingido no limite ou antes, e você não ajudou além do que essa tarefa permite.
- **assisted.** O critério só foi atingido depois de uma ajuda que este roteiro não permite. Escreva o que você fez em `errors`. Assisted não é sucesso.
- **failed.** O limite foi atingido e o critério não foi cumprido. A pessoa ainda estava tentando.
- **abandoned.** A pessoa parou a tarefa antes do limite, e o critério não foi cumprido.

## O que você pode e não pode dizer

Você pode ler a tarefa de novo, palavra por palavra. Você pode dizer que não pode fazer a tarefa no lugar da pessoa. Você pode usar a linha «Pode» daquela tarefa.

Você não pode explicar como o Taalcut funciona, nomear um controle que a tarefa não deixa você apontar, clicar, digitar ou escolher no lugar da pessoa, nem dizer se a pessoa está perto.

## Pergunta de facilidade

Depois de cada tarefa, leia isto palavra por palavra. Não reformule.

> Numa escala de 1 a 7, em que 1 é muito difícil e 7 é muito fácil, o quão fácil foi essa tarefa?

Anote o número inteiro que a pessoa disser. Se a pessoa responder com uma palavra, faça a pergunta mais uma vez. Não escolha um número no lugar da pessoa. Se ainda assim a pessoa não der um inteiro de 1 a 7, encerre a sessão e não registre uma nota inventada.

## T1. Instalar a partir do DMG e abrir

- **Limite:** 10 minutos.
- **Leia e depois comece o cronômetro:** «Instale o Taalcut a partir deste DMG e abra.»
- **Sucesso:** a janela do aplicativo está aberta.
- **Pode:** apontar para o DMG.
- **Não pode:** clicar no lugar da pessoa.

Depois leia a pergunta de facilidade palavra por palavra.

## T2. Integração até uma biblioteca ser importada

- **Limite:** 15 minutos.
- **Leia e depois comece o cronômetro:** «Siga a integração até uma biblioteca ser importada. Use seu celular, ou esta pasta.»
- **Sucesso:** pelo menos um clipe está visível na biblioteca.
- **Pode:** oferecer o celular ou a pasta que você trouxe.
- **Não pode:** importar a biblioteca no lugar da pessoa.

Depois leia a pergunta de facilidade palavra por palavra.

## T3. Primeiro vídeo a partir de um modelo inicial

- **Limite:** 20 minutos.
- **Leia e depois comece o cronômetro:** «Faça um primeiro vídeo a partir de um modelo inicial. Não use um reel de referência.»
- **Sucesso:** existe um arquivo de exportação.
- **Pode:** repetir que é um modelo inicial e não um reel de referência.
- **Não pode:** escolher o modelo ou exportar no lugar da pessoa.

Depois leia a pergunta de facilidade palavra por palavra.

## T4. Um vídeo a partir do link de um reel

- **Limite:** 20 minutos.
- **Leia e depois comece o cronômetro:** «Faça um vídeo a partir do link do reel que está neste cartão.»
- **Sucesso:** existe um arquivo de exportação.
- **Pode:** entregar o cartão com o link do reel.
- **Não pode:** explicar o produto, nem explicar o que é o link.

Depois leia a pergunta de facilidade palavra por palavra.

## T5. Trocar um clipe e exportar

- **Limite:** 10 minutos.
- **Leia e depois comece o cronômetro:** «Troque um clipe e exporte.»
- **Sucesso:** a nova exportação usa o clipe que a pessoa escolheu.
- **Pode:** repetir que a pessoa deve trocar um clipe e exportar.
- **Não pode:** escolher o clipe ou exportar no lugar da pessoa.

Depois leia a pergunta de facilidade palavra por palavra.

## T6. Mudar o idioma e o estilo da legenda

- **Limite:** 10 minutos.
- **Leia e depois comece o cronômetro:** «Mude o idioma e o estilo da legenda.»
- **Sucesso:** o idioma da interface mudou e as legendas usam o estilo que a pessoa escolheu.
- **Pode:** repetir que a pessoa deve mudar o idioma e o estilo da legenda.
- **Não pode:** mudar o idioma ou o estilo da legenda no lugar da pessoa.

Depois leia a pergunta de facilidade palavra por palavra.

## Perguntas abertas

No fim, leia estas três perguntas palavra por palavra, uma de cada vez. Escreva o que a pessoa disser. Não transforme um dar de ombros num achado que a pessoa não falou.

1. «O que foi confuso?»
2. «O que você contaria para um amigo?»
3. «O que você esperava que acontecesse e não aconteceu?»

## Tempo até o primeiro vídeo

`timeToFirstVideoSeconds` é o número de segundos do início de T1, quando T1 é lida, até o fim da primeira exportação. É o fim de T3, ou antes, se a pessoa exportou mais cedo.

Pare esse relógio quando o arquivo de exportação existir, não quando a pessoa notar depois. Se a pessoa nunca exportar, não escreva 0 e não chute. Deixe a sessão fora da pasta do resumo em vez de inventar uma duração.

## Achados

Cada achado é algo que você observou: uma gravidade (`high`, `medium` ou `low`), a área do produto, o que aconteceu e a evidência (o que você viu ou o que a pessoa disse). A mesma nota, fora maiúsculas e espaços a mais, é um só achado. Não registre um achado que você não viu.

## Códigos do registro

Mantenha estes códigos em inglês no JSON, mesmo que a conversa tenha sido em outra língua: resultados `success`, `assisted`, `failed`, `abandoned`; gravidades `high`, `medium`, `low`; idioma `en`, `hi`, `es` ou `pt-BR`. Uma sessão real tem `synthetic` como `false`.
