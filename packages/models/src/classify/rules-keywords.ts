// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The rules router's word lists in the four v1 languages (English, Hindi, Spanish, Brazilian Portuguese): what
 * creators say when they want each tool family, and what they say when no tool should run (greetings, thanks,
 * questions about words, taste, "don't touch it"). Phrases are matched word for word after stemming
 * (rules-text.ts). A family missing here is still scored by BM25 over its description and tools.
 */

export interface FamilyWords {
  /** Words that name the family's work outright ("transcribe", "export"). */
  readonly strong: readonly string[];
  /** Words that lean towards it ("sound", "picture"). */
  readonly weak: readonly string[];
}

/** Phrases are written '|'-separated to keep the tables compact. */
function list(...lines: string[]): string[] {
  return lines.flatMap((line) => line.split('|')).filter((phrase) => phrase.length > 0);
}

export const FAMILY_WORDS: Readonly<Record<string, FamilyWords>> = {
  library: {
    strong: list(
      'import|importing|ingest|bring in|add the folder|add folder|search the bin|look up|tagged|similar',
      'more like this|other takes|asset|library|card import|coming in|importar|importándose|biblioteca',
      'buscar|procurar|carpeta|pasta|इम्पोर्ट|लाइब्रेरी|खोजो',
    ),
    weak: list(
      'folder|card|disk|find|where|search|bin|footage|already shot|we have|details|show me|add',
      'same look|clip where|encuentra|encontrar|clips|añadir|adicionar',
    ),
  },
  media: {
    strong: list(
      'codec|frame rate|metadata|probe|normalise|normalize|conform|proxy|proxies|transcode',
      'lightweight copy|camera file|rushes|4k|1080|resolution|códec|resolución|resolução|प्रॉक्सी',
    ),
    weak: list(
      'duration|file|match the sequence|project frame|convert|technically|master|prep|stuttering',
      'lagging|convertir|converter|archivo|arquivo',
    ),
  },
  vision: {
    strong: list(
      'describe|frame|still|ocr|text on screen|on screen text|burned-in|scene change|detect the shots',
      'split this into shots|where are the cuts|out of focus|focus|shake|index|embed|searchable by look',
      'visually|with your eyes|fotograma|imagen|quadro|imagem|फ्रेम|तस्वीर|दिख',
    ),
    weak: list(
      'picture|look at|see|shot|usable|cleaner|take|read the text|sign|what is in|what s in|blur|shaky',
      'describe|qué hay|o que tem',
    ),
  },
  audio: {
    strong: list(
      'audio|sound|beat|beats|downbeat|tempo|bpm|transcribe|transcript|speech to text|loudness|lufs',
      'quiet|peaking|duck|dialogue|what we hear|what did they say|música|sonido|som|ritmo|transcribir',
      'transcrever|volumen|volume|आवाज़|संगीत|गाना|ऑडियो',
    ),
    weak: list('music|song|track|voice|loud|mix|write down the words|what she says|grid|levels|hear'),
  },
  templates: {
    strong: list(
      'template|templates|reference|format|formats|intake|break down|breakdown|structure|pattern',
      'for next time|like that ad|plantilla|referencia|referência|formato|estructura|estrutura|modelo',
      'टेम्पलेट|रेफ़रेंस',
    ),
    weak: list(
      'ad|reel|sections|why this|save|keep this|video of my|make a video|follow this|start from',
      'their video|store this',
    ),
  },
  timeline: {
    strong: list(
      'timeline|rough cut|first cut|assemble|stringout|trim|shorter|tighten|swap|replace|lower third',
      'title|end card|poster frame|grab a still|capture this frame|cast|role|story order|reorder',
      'más corto|mais curto|línea de tiempo|linha do tempo|recorta|corta|टाइमलाइन|छोटा',
    ),
    weak: list(
      'cut|order|before|move|front|selects|lay out|slot|host|assign|use the|head of|pause|should say',
      'text|put|pass|cambia|troca',
    ),
  },
  render: {
    strong: list(
      'export|render|deliver|final file|mp4|caption|captions|subtitle|subtitles|burn in|qa|preview',
      'ready to show|finish the video|exportar|subtítulos|legendas|renderizar|एक्सपोर्ट|कैप्शन|सबटाइटल',
    ),
    weak: list(
      'master|words on the picture|words should|problems|mistakes|check|send|good enough|watch',
      'write the',
    ),
  },
  sandbox: {
    strong: list('sandbox|script|snippet|code|custom|one-off|execute|código|स्क्रिप्ट|कोड'),
    weak: list('run|transform|ejecuta|executar'),
  },
  images: {
    strong: list(
      'generate an image|generate a picture|ai image|make an image|illustration|genera una imagen',
      'gerar imagem|gere uma imagem|तस्वीर बनाओ',
    ),
    weak: list('image|generate|draw|still for'),
  },
  graphics: {
    strong: list('motion graphic|counter|callout|animated list|contador|animação'),
    weak: list('count up|pointing at|percent|por ciento|por cento'),
  },
  voice: {
    strong: list('voiceover|voice over|narration|narrate|locución|voz en off|narração|वॉइसओवर'),
    weak: list('read this script|say it|my voice'),
  },
  soul: {
    strong: list('more professional|more playful|tone|más profesional|mais profissional'),
    weak: list('talk less|explain more|be brief|be shorter'),
  },
};

/** What a message says when no tool should run. Weighted like family words. */
export const NONE_WORDS: FamilyWords = {
  strong: list(
    'hello|hey|good morning|namaste|thanks|thank you|joke|what is a|what does|mean|explain',
    'remind me what|what can you do|which languages|how does|no tools|ignore tools|ignore previous',
    "ignore the|don't touch|without changing|just talk|make it better|which do you like|do you like",
    'what would you do|just saying|hold on|can you hear|love this|hola|gracias|qué es|olá|oi|obrigado',
    'o que é|नमस्ते|धन्यवाद|शुक्रिया|मतलब',
  ),
  weak: list(
    "prefer|feel|felt|prettier|that's all|leave it|yet|which of these|stuck|offline|wait|hate",
    'you there|tell me',
  ),
};
