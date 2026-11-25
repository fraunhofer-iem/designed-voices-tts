// Interface copy for the browser preview. German and English are complete
// translations, not string fragments: every message is one whole sentence or
// label, parameters are named placeholders, and unknown locales or keys fail
// closed instead of falling back to half-translated text.
//
// Keys ending in `.one` / `.other` are selected with Intl.PluralRules when the
// caller passes a numeric `count`. `TRUSTED_HTML_KEYS` are the only messages
// allowed to carry markup; they are constants in this file, never user input.

export const LOCALES = Object.freeze(['de', 'en']);
export const DEFAULT_LOCALE = 'de';
export const TRUSTED_HTML_KEYS = Object.freeze(['intro.title', 'funding.text']);

const de = Object.freeze({
  'document.title': 'Sprachsynthese im Browser · ENGAGE-KI',
  'brand.subtitle': 'Sprachsynthese',
  'nav.measurements': 'Messwerte',
  'locale.group': 'Sprache der Oberfläche',
  'studio.label': 'Sprachsynthese',

  'intro.title': 'Sprachsynthese<br><em>im Browser</em>',
  'intro.body': 'Text eingeben, Modell und Stimme wählen. Die Sprache wird lokal im Browser erzeugt.',
  'intro.localLabel': 'Verarbeitung im Browser',
  'intro.localNote': 'CPU statt GPU. Deutsch und Englisch. Kein Textversand zur Spracherzeugung.',

  'editor.heading': 'Text',
  'editor.count': '{count} / {limit}',
  'editor.textLabel': 'Text zur Spracherzeugung',
  'editor.shortcut': 'Strg+Eingabetaste oder Cmd+Eingabetaste erzeugt das Audio.',
  'sample.label': 'Beispieltexte',
  'example.plain': 'Aussage',
  'example.question': 'Frage',
  'example.time': 'Datum und Uhrzeit',
  'example.amount': 'Betrag',
  'example.abbreviation': 'Abkürzung',
  'sample.text.de': 'Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.',
  'sample.text.en': 'The meeting starts at nine. Please close the door.',

  'select.model': 'Modell',
  'select.language': 'Sprache',
  'select.voice': 'Stimme',
  'compare.label': 'Vergleichsstimme',
  'compare.none': 'Keine',
  'compare.info.none': 'optional',
  'compare.info.set': 'zwei Ausgaben',
  'compare.female': '{model} · Weibliche Stimme {code}',
  'compare.male': '{model} · Männliche Stimme {code}',
  'rate.label': 'Sprechtempo',
  'rate.value': '{rate}×',
  'lang.de': 'Deutsch',
  'lang.en': 'English',

  'model.heading': 'Modell und Dateien',
  'model.sectionLabel': 'Modelldateien und Ladestatus',
  'loading.sizePending': 'Größe wird ermittelt',
  'loading.idle': 'Wird beim ersten Erzeugen geladen.',
  'loading.note': 'Einmal Dateien laden und das Modell starten. Danach wird der Text lokal erzeugt und direkt abgespielt.',
  'loading.noteBudget': 'Alle Modelle und Laufzeit: {size} MB. Geladen werden die Dateien für die aktuelle Auswahl.',
  'loading.stateIdle': '{size} MB mit Frontend und Laufzeit · Laden beim Erzeugen',
  'loading.stateVerify': 'Dateien geprüft · Modell startet …',
  'loading.stateDownload': '{verified} / {total} MB geprüft · Dateien werden geladen …',
  'loading.stateReady': 'Modell bereit · Erzeugung startet ohne erneuten Download',
  'loading.stateLoaded': 'Dateien geladen · Modell startet beim Erzeugen',
  'loading.progressLabel': 'Prüfsummen-geprüfte Dateien',

  'voice.count.german.one': '{count} deutsche Stimme',
  'voice.count.german.other': '{count} deutsche Stimmen',
  'voice.count.english.one': '{count} englische Stimme',
  'voice.count.english.other': '{count} englische Stimmen',
  'voice.female': 'Weibliche Stimme {code} · {language}',
  'voice.male': 'Männliche Stimme {code} · {language}',

  'action.generate': 'Erzeugen und abspielen',
  'action.generating': 'Erzeugen …',
  'action.cancel': 'Abbrechen',

  'engine.fallback': 'CPU / WASM',
  'engine.runtime.one': 'CPU / WASM · {threads} Thread',
  'engine.runtime.other': 'CPU / WASM · {threads} Threads',
  'audio.format': '24 kHz · Mono',

  'wave.title': 'Keine Wellenform',
  'wave.body': 'Nach dem Erzeugen zeigt dieser Bereich die Wellenform des erzeugten Audios.',
  'wave.canvasLabel': 'Wellenform des erzeugten Audios',
  'audio.none': 'Noch kein Audio',
  'audio.detail': 'Nach dem Erzeugen wird das Audio automatisch abgespielt.',
  'audio.summary.one': '{model} · {rate} · {seconds} s · {count} Abschnitt',
  'audio.summary.other': '{model} · {rate} · {seconds} s · {count} Abschnitte',
  'audio.duration': '{seconds} s',
  'audio.play': 'Audio abspielen',
  'audio.pause': 'Audio pausieren',
  'audio.replay': 'Audio erneut abspielen',

  'reading.label': 'Gelesen als',
  'reading.phones': 'Lautschrift',

  'outputs.title': 'Ausgaben',
  'outputs.count': '{count} / {limit}',
  'outputs.empty': 'Noch keine Ausgaben. Die letzten {limit} Ausgaben dieser Sitzung erscheinen hier.',
  'outputs.clear': 'Liste leeren',
  'outputs.listLabel': 'Ausgaben dieser Sitzung',
  'outputs.female': 'Weibliche Stimme {code}',
  'outputs.male': 'Männliche Stimme {code}',
  'outputs.meta': '{model} · {language} · {rate} · {seconds} s',
  'outputs.metaComparison': '{model} · {language} · {rate} · {seconds} s · Vergleichsstimme',
  'outputs.play': 'Ausgabe abspielen: {voice}, {model}',
  'outputs.pause': 'Ausgabe pausieren: {voice}, {model}',
  'outputs.download': 'WAV',
  'outputs.downloadLabel': 'WAV herunterladen: {voice}, {model}',
  'outputs.filename': 'engage-ki-sprachsynthese-{model}-{voice}-{rate}.wav',

  'download.wav': 'WAV herunterladen',
  'download.filename': 'engage-ki-sprachsynthese.wav',
  'metrics.export': 'Messwerte als JSON',
  'metrics.exportFilename': 'engage-ki-messwerte.json',

  'status.ready': 'Bereit. Das Modell wird beim Erzeugen geladen.',
  'status.preparing': 'Das Modell wird vorbereitet.',
  'status.done': 'Audio bereit.',
  'status.donePair': 'Beide Ausgaben bereit.',
  'status.cleared': 'Liste geleert.',
  'status.autoplayBlocked': 'Audio bereit. Bitte auf Abspielen tippen; der Browser hat den automatischen Start blockiert.',
  'status.playFailed': 'Audio konnte nicht starten. Bitte noch einmal Abspielen wählen.',
  'status.cancelled': 'Abgebrochen. Text oder Stimme können geändert und neu erzeugt werden.',
  'status.cancelLoad': 'Abgebrochen · beim nächsten Erzeugen erneut vorbereiten',
  'status.emptyText': 'Bitte zuerst einen Text eingeben.',
  'status.busy': 'Es wird bereits eine Stimme erzeugt.',
  'status.notLoaded': 'Die Anwendung ist noch nicht geladen.',
  'status.modelFailed': 'Modellvorbereitung fehlgeschlagen: {detail}',
  'status.aborted': 'Abgebrochen',

  'progress.withDetail': '{label} · {detail}',
  'progress.label': '{label}',
  'progress.voice': 'Stimme {index} von {total} · {progress}',
  'progress.detail.loading': 'Frontend und Modell laden',
  'progress.detail.chunk': 'Abschnitt {index} / {total}',

  'stage.loading': 'Dateien laden',
  'stage.normalization': 'Text normalisieren',
  'stage.phonemization': 'Lautschrift planen',
  'stage.synthesis': 'Synthese',
  'stage.acoustic': 'Akustische Planung',
  'stage.waveform': 'Klang erzeugen',
  'stage.marking': 'Wasserzeichen',

  'metrics.title': 'Messwerte',
  'metrics.intro': 'Live-Messwerte dieser Sitzung; angezeigt werden nur Werte, die der Browser liefert.',
  'metrics.synth': 'Synthese',
  'metrics.synthNote': 'Echtzeitfaktor nach der Synthese',
  'metrics.rtf': 'RTF {rtf} · {factor}× Echtzeit',
  'metrics.ready': 'Text zu Audio bereit',
  'metrics.readyNote': 'Einschließlich Laden und Vorbereitung',
  'metrics.memory': 'WASM-Speicher im Frontend',
  'metrics.memoryNote': 'Reservierte Kapazität, nicht Gesamt-RAM',
  'metrics.files': 'Geprüfte Dateien',
  'metrics.filesNote': 'Modell, Frontend und Laufzeit',
  'metrics.cache': 'Davon {size} MB im Browser-Cache',
  'metrics.unavailable': 'Nicht verfügbar',
  'metrics.details': 'Messgrenzen und einzelne Schritte',
  'metrics.limits': 'CPU-Auslastung, Prozess-RAM und freier physischer Speicherplatz lassen sich über eine Webseite nicht zuverlässig messen. Angezeigt werden nur Werte, die der Browser liefert. Frontend-WASM umfasst Phony und nrmlz; interne ONNX- und QuickJS-Allokationen sind darin nicht enthalten. Der Wert für „Text zu Audio bereit“ ist keine gemessene hörbare Latenz.',
  'metrics.cpuUtil': 'CPU-Auslastung',
  'metrics.notMeasurable': 'Nicht messbar',
  'metrics.processRss': 'Prozess-RAM (RSS)',
  'metrics.storageQuota': 'Browser-Speicherquote',
  'metrics.jsHeap': 'JS-Heap (Schätzung)',
  'metrics.storageRemaining': '~{size} MB Kontingent übrig',

  'method.title': 'Modelle und Laufzeit',
  'method.body1': 'Kale Nano bietet vier deutsche Stimmen; Voca64 bietet deutsche und englische Stimmen. Jede Stimme ist genau einem Modell zugeordnet.',
  'method.body1.kalePair': 'Kale Nano DE bietet vier deutsche Stimmen. Kale Nano EN ist das öffentliche Modell Kale TTS 1 Nano von Kale Computer, nicht nachtrainiert, mit acht englischen Stimmen. Jede Stimme ist genau einem Modell zugeordnet.',
  'method.body1.kaleFresh': 'Kale Nano DE bietet vier deutsche Stimmen, Kale Nano EN vier englische Stimmen. Jede Stimme ist genau einem Modell zugeordnet.',
  'method.body1.kaleFreshVoca': 'Kale Nano DE bietet vier deutsche Stimmen, Kale Nano EN vier englische Stimmen; Voca64 bietet deutsche und englische Stimmen. Jede Stimme ist genau einem Modell zugeordnet.',
  'method.body1.other': 'Jede Stimme ist genau einem Modell zugeordnet.',
  'method.body2': 'nrmlz normalisiert den Text, Phony erzeugt die Lautschrift. Die Modelle erzeugen daraus die Sprache lokal im Browser. Qualität und Ressourcenbedarf hängen von Modell, Text und Gerät ab.',
  'method.body2.metadata': 'nrmlz normalisiert den Text, Phony erzeugt die Lautschrift. Die Modelle erzeugen daraus die Sprache lokal im Browser. Qualität und Ressourcenbedarf hängen von Modell, Text und Gerät ab. Heruntergeladene WAV-Dateien enthalten Metadaten, die sie als KI-erzeugte Sprache kennzeichnen.',
  'method.body2.marked': 'nrmlz normalisiert den Text, Phony erzeugt die Lautschrift. Die Modelle erzeugen daraus die Sprache lokal im Browser. Qualität und Ressourcenbedarf hängen von Modell, Text und Gerät ab. Jede Ausgabe enthält ein Audio-Wasserzeichen (AudioSeal), WAV-Dateien zusätzlich Metadaten; beides kennzeichnet sie als KI-erzeugte Sprache. Eine Datei lässt sich mit dem Detektor im Quellcode prüfen.',
  'link.voca': 'Voca-Modell ↗',
  'link.kale': 'Kale-Modell ↗',
  'link.kaleEn': 'Kale TTS 1 Nano (Englisch) ↗',
  'link.kaleFreshEn': 'Kale-Modell (Englisch) ↗',
  'link.source': 'Code und Lizenzen ↗',

  'funding.text': 'Gefördert durch das Bundesministerium für Forschung, Technologie und Raumfahrt <strong>(BMFTR)</strong> im Rahmen des Projekts <strong>ENGAGE-KI</strong>. Betreut vom Projektträger Karlsruhe <strong>(PTKA)</strong>.',

  'error.unknown': 'Unerwarteter Fehler: {detail}',
  'error.selection': 'Die gewählte Kombination aus Modell, Sprache und Stimme ist ungültig.',
  'error.textLength': 'Bitte 1 bis 500 Zeichen eingeben.',
  'error.textUnpronounceable': 'Der Text enthält nichts Aussprechbares.',
  'error.textTooLong': 'Der Text ist zu lang für Audio von bis zu einer Minute.',
  'error.chunkTooLong': 'Ein Abschnitt überschreitet die sichere Audiolänge.',
  'error.rate': 'Das Sprechtempo liegt außerhalb des zulässigen Bereichs.',
  'error.rateChunkTooLong': 'Bei diesem Sprechtempo überschreitet ein Abschnitt die sichere Audiolänge. Bitte ein höheres Tempo wählen oder den Text kürzen.',
  'error.rateTooLong': 'Bei diesem Sprechtempo wird das Audio länger als eine Minute. Bitte ein höheres Tempo wählen oder den Text kürzen.',
  'error.compare': 'Die Vergleichsstimme passt nicht zur gewählten Sprache.',
  'error.invalidAudio': 'Das Modell hat ungültiges Audio geliefert.',
  'error.download': 'Datei konnte nicht geladen werden: {asset}',
  'error.checksum': 'Prüfsumme stimmt nicht: {asset}',
  'error.unknownAsset': 'Unbekannte Datei im Modellpaket: {asset}',
  'error.worker': 'Der Worker für die Spracherzeugung konnte nicht gestartet werden.',
  'error.runtimePending': 'Die Laufzeit wird noch vorbereitet. Bitte gleich neu laden.',
  'error.runtimeIncomplete': 'Die Laufzeit ist unvollständig.',
  'error.englishFrontend': 'Fehler im englischen Frontend: {detail}',
  'error.englishDeadline': 'Die Lautschrift für Englisch hat das Zeitlimit überschritten.',
  'error.marking': 'Das Wasserzeichen konnte nicht eingefügt werden. Es wurde keine Ausgabe erzeugt.',
  'error.markingLoad': 'Das Wasserzeichen konnte nicht geladen werden. Es wurde keine Ausgabe erzeugt.'
});

const en = Object.freeze({
  'document.title': 'Text-to-speech in the browser · ENGAGE-KI',
  'brand.subtitle': 'Speech synthesis',
  'nav.measurements': 'Measurements',
  'locale.group': 'Interface language',
  'studio.label': 'Speech synthesis',

  'intro.title': 'Text-to-speech<br><em>in the browser</em>',
  'intro.body': 'Enter text, choose a model and a voice. Speech is generated locally in your browser.',
  'intro.localLabel': 'Processing in the browser',
  'intro.localNote': 'CPU instead of GPU. German and English. No text is sent for synthesis.',

  'editor.heading': 'Text',
  'editor.count': '{count} / {limit}',
  'editor.textLabel': 'Text to synthesize',
  'editor.shortcut': 'Ctrl+Enter or Cmd+Enter generates the audio.',
  'sample.label': 'Sample texts',
  'example.plain': 'Statement',
  'example.question': 'Question',
  'example.time': 'Date and time',
  'example.amount': 'Amount',
  'example.abbreviation': 'Abbreviation',
  'sample.text.de': 'Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.',
  'sample.text.en': 'The meeting starts at nine. Please close the door.',

  'select.model': 'Model',
  'select.language': 'Speech language',
  'select.voice': 'Voice',
  'compare.label': 'Comparison voice',
  'compare.none': 'None',
  'compare.info.none': 'optional',
  'compare.info.set': 'two outputs',
  'compare.female': '{model} · Female voice {code}',
  'compare.male': '{model} · Male voice {code}',
  'rate.label': 'Speaking rate',
  'rate.value': '{rate}×',
  'lang.de': 'German',
  'lang.en': 'English',

  'model.heading': 'Model and files',
  'model.sectionLabel': 'Model files and load status',
  'loading.sizePending': 'Size pending',
  'loading.idle': 'Loads on first generate.',
  'loading.note': 'Load the files and start the model once. Afterwards the text is generated locally and played right away.',
  'loading.noteBudget': 'All models and runtime: {size} MB. Only the files needed for the current selection are loaded.',
  'loading.stateIdle': '{size} MB with frontend and runtime · loads on generate',
  'loading.stateVerify': 'Files verified · model starting …',
  'loading.stateDownload': '{verified} / {total} MB verified · loading files …',
  'loading.stateReady': 'Model ready · generation starts without another download',
  'loading.stateLoaded': 'Files loaded · model starts on generate',
  'loading.progressLabel': 'Checksum-verified files',

  'voice.count.german.one': '{count} German voice',
  'voice.count.german.other': '{count} German voices',
  'voice.count.english.one': '{count} English voice',
  'voice.count.english.other': '{count} English voices',
  'voice.female': 'Female voice {code} · {language}',
  'voice.male': 'Male voice {code} · {language}',

  'action.generate': 'Generate and play',
  'action.generating': 'Generating…',
  'action.cancel': 'Cancel',

  'engine.fallback': 'CPU / WASM',
  'engine.runtime.one': 'CPU / WASM · {threads} thread',
  'engine.runtime.other': 'CPU / WASM · {threads} threads',
  'audio.format': '24 kHz · Mono',

  'wave.title': 'No waveform',
  'wave.body': 'After generation this area shows the waveform of the generated audio.',
  'wave.canvasLabel': 'Waveform of the generated audio',
  'audio.none': 'No audio yet',
  'audio.detail': 'After generation the audio plays automatically.',
  'audio.summary.one': '{model} · {rate} · {seconds} s · {count} segment',
  'audio.summary.other': '{model} · {rate} · {seconds} s · {count} segments',
  'audio.duration': '{seconds} s',
  'audio.play': 'Play audio',
  'audio.pause': 'Pause audio',
  'audio.replay': 'Replay audio',

  'reading.label': 'Read as',
  'reading.phones': 'Phonemes',

  'outputs.title': 'Outputs',
  'outputs.count': '{count} / {limit}',
  'outputs.empty': 'No outputs yet. The last {limit} outputs of this session appear here.',
  'outputs.clear': 'Clear list',
  'outputs.listLabel': 'Outputs of this session',
  'outputs.female': 'Female voice {code}',
  'outputs.male': 'Male voice {code}',
  'outputs.meta': '{model} · {language} · {rate} · {seconds} s',
  'outputs.metaComparison': '{model} · {language} · {rate} · {seconds} s · comparison voice',
  'outputs.play': 'Play output: {voice}, {model}',
  'outputs.pause': 'Pause output: {voice}, {model}',
  'outputs.download': 'WAV',
  'outputs.downloadLabel': 'Download WAV: {voice}, {model}',
  'outputs.filename': 'engage-ki-speech-{model}-{voice}-{rate}.wav',

  'download.wav': 'Download WAV',
  'download.filename': 'engage-ki-speech.wav',
  'metrics.export': 'Measurements as JSON',
  'metrics.exportFilename': 'engage-ki-measurements.json',

  'status.ready': 'Ready. The model loads when you generate.',
  'status.preparing': 'Preparing the model.',
  'status.done': 'Audio ready.',
  'status.donePair': 'Both outputs ready.',
  'status.cleared': 'List cleared.',
  'status.autoplayBlocked': 'Audio ready. Tap play; the browser blocked automatic playback.',
  'status.playFailed': 'Audio could not start. Choose play again.',
  'status.cancelled': 'Cancelled. You can change the text or voice and generate again.',
  'status.cancelLoad': 'Cancelled · prepared again on next generate',
  'status.emptyText': 'Enter a text first.',
  'status.busy': 'A voice is already being generated.',
  'status.notLoaded': 'The application is not loaded yet.',
  'status.modelFailed': 'Model preparation failed: {detail}',
  'status.aborted': 'Cancelled',

  'progress.withDetail': '{label} · {detail}',
  'progress.label': '{label}',
  'progress.voice': 'Voice {index} of {total} · {progress}',
  'progress.detail.loading': 'Loading frontend and model',
  'progress.detail.chunk': 'Segment {index} / {total}',

  'stage.loading': 'Loading files',
  'stage.normalization': 'Normalizing text',
  'stage.phonemization': 'Planning phonemes',
  'stage.synthesis': 'Synthesis',
  'stage.acoustic': 'Acoustic planning',
  'stage.waveform': 'Rendering audio',
  'stage.marking': 'Watermark',

  'metrics.title': 'Measurements',
  'metrics.intro': 'Live measurements for this session; only values the browser reports are shown.',
  'metrics.synth': 'Synthesis',
  'metrics.synthNote': 'Real-time factor after synthesis',
  'metrics.rtf': 'RTF {rtf} · {factor}× real time',
  'metrics.ready': 'Text to audio ready',
  'metrics.readyNote': 'Including loading and preparation',
  'metrics.memory': 'WASM memory in the frontend',
  'metrics.memoryNote': 'Reserved capacity, not total RAM',
  'metrics.files': 'Verified files',
  'metrics.filesNote': 'Model, frontend and runtime',
  'metrics.cache': '{size} MB stored in the browser cache',
  'metrics.unavailable': 'Not available',
  'metrics.details': 'Measurement limits and individual stages',
  'metrics.limits': 'CPU utilization, process RAM and physical free disk space cannot be measured reliably from a web page. Only values the browser reports are shown. Frontend WASM covers Phony and nrmlz; internal ONNX and QuickJS allocations are not included. The value for "text to audio ready" is not a measured audible latency.',
  'metrics.cpuUtil': 'CPU utilization',
  'metrics.notMeasurable': 'Not measurable',
  'metrics.processRss': 'Process RAM (RSS)',
  'metrics.storageQuota': 'Browser storage quota',
  'metrics.jsHeap': 'JS heap (estimate)',
  'metrics.storageRemaining': '~{size} MB quota remaining',

  'method.title': 'Models and runtime',
  'method.body1': 'Kale Nano provides four German voices; Voca64 provides German and English voices. Each voice belongs to exactly one model.',
  'method.body1.kalePair': 'Kale Nano DE provides four German voices. Kale Nano EN is the public model Kale TTS 1 Nano by Kale Computer, not retrained, with eight English voices. Each voice belongs to exactly one model.',
  'method.body1.kaleFresh': 'Kale Nano DE provides four German voices, Kale Nano EN four English voices. Each voice belongs to exactly one model.',
  'method.body1.kaleFreshVoca': 'Kale Nano DE provides four German voices, Kale Nano EN four English voices; Voca64 provides German and English voices. Each voice belongs to exactly one model.',
  'method.body1.other': 'Each voice belongs to exactly one model.',
  'method.body2': 'nrmlz normalizes the text, Phony converts it into phonemes. The models generate the speech locally in your browser. Output quality and resource use depend on the model, the text and the device.',
  'method.body2.metadata': 'nrmlz normalizes the text, Phony converts it into phonemes. The models generate the speech locally in your browser. Output quality and resource use depend on the model, the text and the device. Downloaded WAV files contain metadata that marks them as AI-generated speech.',
  'method.body2.marked': 'nrmlz normalizes the text, Phony converts it into phonemes. The models generate the speech locally in your browser. Output quality and resource use depend on the model, the text and the device. Every output carries an audio watermark (AudioSeal), and WAV files also carry metadata; both mark it as AI-generated speech. A file can be checked with the detector in the source code.',
  'link.voca': 'Voca model ↗',
  'link.kale': 'Kale model ↗',
  'link.kaleEn': 'Kale TTS 1 Nano (English) ↗',
  'link.kaleFreshEn': 'Kale model (English) ↗',
  'link.source': 'Code and licences ↗',

  'funding.text': 'Funded by the Bundesministerium für Forschung, Technologie und Raumfahrt <strong>(BMFTR)</strong> through ENGAGE-KI. Administered by Projektträger Karlsruhe <strong>(PTKA)</strong>.',

  'error.unknown': 'Unexpected error: {detail}',
  'error.selection': 'The selected combination of model, language and voice is invalid.',
  'error.textLength': 'Enter 1 to 500 characters.',
  'error.textUnpronounceable': 'The text contains nothing pronounceable.',
  'error.textTooLong': 'The text is too long for audio of up to one minute.',
  'error.chunkTooLong': 'A segment exceeds the safe audio length.',
  'error.rate': 'The speaking rate is outside the allowed range.',
  'error.rateChunkTooLong': 'At this speaking rate a segment exceeds the safe audio length. Choose a higher rate or shorten the text.',
  'error.rateTooLong': 'At this speaking rate the audio would be longer than one minute. Choose a higher rate or shorten the text.',
  'error.compare': 'The comparison voice does not match the selected speech language.',
  'error.invalidAudio': 'The model returned invalid audio.',
  'error.download': 'File could not be downloaded: {asset}',
  'error.checksum': 'Checksum mismatch: {asset}',
  'error.unknownAsset': 'Unknown file in the model package: {asset}',
  'error.worker': 'The worker for speech synthesis could not start.',
  'error.runtimePending': 'The runtime is still being prepared. Reload in a moment.',
  'error.runtimeIncomplete': 'The runtime is incomplete.',
  'error.englishFrontend': 'English frontend error: {detail}',
  'error.englishDeadline': 'English phonemization exceeded its time limit.',
  'error.marking': 'The watermark could not be applied. No output was produced.',
  'error.markingLoad': 'The watermark could not be loaded. No output was produced.'
});

const messages = Object.freeze({de, en});
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export function isLocale(value) {
  return typeof value === 'string' && LOCALES.includes(value);
}

export function normalizeLocale(value) {
  if (!isLocale(value)) throw Error('UNKNOWN_LOCALE:' + String(value));
  return value;
}

export function messageKeys(locale) {
  return Object.keys(messages[normalizeLocale(locale)]);
}

export function hasMessage(locale, key) {
  return Object.hasOwn(messages[normalizeLocale(locale)], key);
}

export function isTrustedHtmlKey(key) {
  return TRUSTED_HTML_KEYS.includes(key);
}

function template(locale, key, params) {
  const table = messages[locale];
  if (Object.hasOwn(table, key)) return table[key];
  if (typeof params?.count === 'number') {
    const plural = new Intl.PluralRules(locale).select(params.count);
    const candidate = table[key + '.' + (plural === 'one' ? 'one' : 'other')];
    if (typeof candidate === 'string') return candidate;
  }
  throw Error('MISSING_MESSAGE:' + locale + ':' + key);
}

export function translate(locale, key, params = {}) {
  const normalized = normalizeLocale(locale);
  return template(normalized, key, params).replace(PLACEHOLDER, (match, name) => {
    if (!Object.hasOwn(params, name) || params[name] === undefined || params[name] === null) {
      throw Error('MISSING_PARAMETER:' + key + ':' + name);
    }
    return String(params[name]);
  });
}

export function createTranslator(locale) {
  const normalized = normalizeLocale(locale);
  return (key, params) => translate(normalized, key, params);
}
