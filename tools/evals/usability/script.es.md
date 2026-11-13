---
status: draft
review: native speaker sign-off still required (H8)
source: script.en.md
---

# Guion del moderador

Esta traducción es un borrador. Todavía falta la revisión de una persona hablante nativa. Lee al participante las líneas entre comillas. No añadas una explicación del producto.

## Antes de la sesión

- La persona participante es creadora y no ha usado Taalcut antes.
- La Mac tiene una cuenta nueva de macOS. No hay nada más instalado. Taalcut no está ya en la máquina.
- Tienes el DMG, un teléfono o una carpeta con metraje, y una tarjeta con un enlace de un reel.
- El consentimiento está firmado antes de grabar. La pantalla y la voz se quedan en esta Mac, salvo que la persona acepte, en la tarjeta, que una copia pueda salir.
- No estás evaluando a la persona. Estás observando el producto.

## Tiempo

- Empieza el cronómetro cuando la tarea se haya leído. El reloj arranca al terminar la línea entre comillas.
- Detén el cronómetro cuando se cumpla el criterio de éxito, o cuando se acabe el tope, lo que ocurra primero.
- No pauses el cronómetro mientras leen, dudan o te preguntan algo que no puedes responder.

## Resultados

Anota un resultado por tarea:

- **success.** El criterio de éxito se cumplió en el tope o antes, y no ayudaste más de lo que esa tarea permite.
- **assisted.** El criterio solo se cumplió después de una ayuda que este guion no permite. Escribe lo que hiciste en `errors`. Assisted no es éxito.
- **failed.** Se llegó al tope y el criterio no se cumplió. Seguían intentándolo.
- **abandoned.** Dejaron la tarea antes del tope, y el criterio no se cumplió.

## Qué puedes decir y qué no

Puedes volver a leer la tarea, palabra por palabra. Puedes decir que no puedes hacer la tarea por la persona. Puedes usar la línea «Puedes» de esa tarea.

No puedes explicar cómo funciona Taalcut, nombrar un control que la tarea no te deja señalar, hacer clic, escribir o elegir por la persona, ni decirle si va cerca.

## Pregunta de facilidad

Después de cada tarea, lee esto tal cual. No lo reformules.

> En una escala del 1 al 7, donde 1 es muy difícil y 7 es muy fácil, ¿qué tan fácil fue esa tarea?

Anota el entero que diga. Si responde con una palabra, haz la pregunta una vez más. No elijas un número por la persona. Si aun así no da un entero del 1 al 7, detén la sesión y no archives una puntuación inventada.

## T1. Instalar desde el DMG y abrir

- **Tope:** 10 minutos.
- **Lee y luego empieza el cronómetro:** «Instala Taalcut desde este DMG y ábrelo.»
- **Éxito:** la ventana de la app está abierta.
- **Puedes:** señalar el DMG.
- **No puedes:** hacer clic por la persona.

Luego lee la pregunta de facilidad tal cual.

## T2. Incorporación hasta importar una biblioteca

- **Tope:** 15 minutos.
- **Lee y luego empieza el cronómetro:** «Sigue la incorporación hasta que se importe una biblioteca. Usa tu teléfono, o esta carpeta.»
- **Éxito:** se ve al menos un clip en la biblioteca.
- **Puedes:** ofrecer el teléfono o la carpeta que trajiste.
- **No puedes:** importar la biblioteca por la persona.

Luego lee la pregunta de facilidad tal cual.

## T3. Primer vídeo desde una plantilla inicial

- **Tope:** 20 minutos.
- **Lee y luego empieza el cronómetro:** «Haz un primer vídeo a partir de una plantilla inicial. No uses un reel de referencia.»
- **Éxito:** existe un archivo de exportación.
- **Puedes:** repetir que es una plantilla inicial y no un reel de referencia.
- **No puedes:** elegir la plantilla o exportar por la persona.

Luego lee la pregunta de facilidad tal cual.

## T4. Un vídeo desde el enlace de un reel

- **Tope:** 20 minutos.
- **Lee y luego empieza el cronómetro:** «Haz un vídeo a partir del enlace del reel que está en esta tarjeta.»
- **Éxito:** existe un archivo de exportación.
- **Puedes:** entregarles la tarjeta con el enlace del reel.
- **No puedes:** explicar el producto, ni explicar qué es el enlace.

Luego lee la pregunta de facilidad tal cual.

## T5. Cambiar un clip y exportar

- **Tope:** 10 minutos.
- **Lee y luego empieza el cronómetro:** «Cambia un clip y exporta.»
- **Éxito:** la nueva exportación usa el clip que eligieron.
- **Puedes:** repetir que deben cambiar un clip y exportar.
- **No puedes:** elegir el clip o exportar por la persona.

Luego lee la pregunta de facilidad tal cual.

## T6. Cambiar el idioma y el estilo de los subtítulos

- **Tope:** 10 minutos.
- **Lee y luego empieza el cronómetro:** «Cambia el idioma y el estilo de los subtítulos.»
- **Éxito:** el idioma de la interfaz cambió y los subtítulos usan el estilo que eligieron.
- **Puedes:** repetir que deben cambiar el idioma y el estilo de los subtítulos.
- **No puedes:** cambiar el idioma o el estilo de los subtítulos por la persona.

Luego lee la pregunta de facilidad tal cual.

## Preguntas abiertas

Al final, lee estas tres preguntas tal cual, de una en una. Escribe lo que digan. No conviertas un encogimiento de hombros en un hallazgo que no dijeron.

1. «¿Qué te resultó confuso?»
2. «¿Qué le contarías a un amigo?»
3. «¿Qué esperabas que pasara y no pasó?»

## Tiempo hasta el primer vídeo

`timeToFirstVideoSeconds` es el número de segundos desde el inicio de T1, cuando se lee T1, hasta el fin de la primera exportación. Es el fin de T3, o antes si exportaron más pronto.

Detén ese reloj cuando el archivo de exportación exista, no cuando lo noten después. Si nunca exportan, no escribas 0 y no adivines. Deja la sesión fuera de la carpeta del resumen en lugar de inventar una duración.

## Hallazgos

Cada hallazgo es algo que observaste: una gravedad (`high`, `medium` o `low`), el área del producto, qué pasó y la evidencia (lo que viste o lo que dijeron). La misma nota, salvo mayúsculas y espacios de más, es un solo hallazgo. No archives un hallazgo que no viste.

## Códigos del registro

Deja estos códigos en inglés en el JSON, aunque hayas hablado en otro idioma: resultados `success`, `assisted`, `failed`, `abandoned`; gravedades `high`, `medium`, `low`; idioma `en`, `hi`, `es` o `pt-BR`. Una sesión real tiene `synthetic` en `false`.
