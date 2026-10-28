# Jarvis

## Starten
1. Ollama-App muss laufen.
2. Einmalig bzw. nach Updates: `setup.bat`
3. Starten: `start.bat` und "beenden" sagen zum Ausschalten.

## Stimme wechseln (config.json -> "stimme")
| Wert    | Klang                 | Internet | Hinweis |
|---------|-----------------------|----------|---------|
| `edge`  | sehr natürlich        | ja       | Standard. Stimme bei "edge_stimme" ändern |
| `xtts`  | sehr natürlich, Klon  | nein     | erst `venv\Scripts\pip install coqui-tts`, Clips in `stimme\` |
| `piper` | okay                  | nein     | schnell, klingt etwas roboterhaft |
| `windows` | einfach             | nein     | Notfall |

Tiefer/schneller: "edge_tonhoehe" (z. B. "-8Hz"), "edge_tempo" (z. B. "+10%").

## Probleme
- Hört nicht auf zuzuhören: "stille_schwelle" auf eine Zahl setzen, z. B. 0.02
- Reagiert nicht: Zahl kleiner machen, z. B. 0.008
- Versteht schlecht: "whisper_modell" auf "medium" (langsamer)

## Grafikkarte (GPU)
- Ollama nutzt die Grafikkarte automatisch. Beim Start zeigt Jarvis an, ob das klappt.
- Whisper auf der GPU (nur NVIDIA): einmal `gpu_setup.bat` ausfuehren.
- Mit GPU lohnt sich ein besseres Whisper-Modell: "whisper_modell": "large-v3-turbo"
| `chatterbox` | am realistischsten, Klon | nein | `chatterbox_setup.bat`, braucht NVIDIA-GPU, Clip in `stimme\` |
