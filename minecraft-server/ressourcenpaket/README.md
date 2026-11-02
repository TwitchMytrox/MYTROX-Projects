# Turkac RP – Ressourcenpaket

![Status](https://img.shields.io/badge/Status-Beta-orange) ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.11-green)

Das Server-Ressourcenpaket für meinen Minecraft-Server **Turkac RP**. Der Server lädt es beim Betreten automatisch herunter.

## Was drin ist

| Teil | Beschreibung |
|------|--------------|
| 🌙 Dark Mode | Alle Container-Menüs (Truhen, Inventar, Öfen, Shops, DeluxeMenus …), Buttons und das Rezeptbuch in dunklem Grau. Ein kleiner Text-Shader macht die dunkelgrauen Menü-Titel hell, damit sie lesbar bleiben. |
| 🔊 Sounds | Menü-Sounds `turkac:ui.click`, `ui.open`, `ui.close`, `ui.success`, `ui.buy`, `ui.error`, `ui.teleport`, `ui.page`, `ui.jump` – plus alle 151 Sounds aus Kenneys „Interface Sounds“ und „UI Audio“ (CC0) als `turkac:kenney.<name>`. |
| 🪪 Personalausweis | Eigene Textur für Papier mit `custom_model_data` = `turkac:personalausweis`. |

## Sounds benutzen (z. B. in DeluxeMenus)

```yaml
- '[console] execute at %player_name% run playsound turkac:ui.click master %player_name% ~ ~ ~ 0.8 1'
```

## Alle Kenney-Sounds direkt nutzen

Jeder Sound aus den beiden Sammlungen ist einzeln abspielbar, z. B. `turkac:kenney.if_confirmation_001` oder `turkac:kenney.ui_click3`. Die Namen stehen in `quelle/assets/turkac/sounds.json`.

## Aufbau

- `TurkacRP-Pack.zip` – das fertige Paket (wird vom Server geladen)
- `quelle/` – der entpackte Inhalt zum Bearbeiten

Nach jeder Änderung neu zippen und in der `server.properties` die neue `resource-pack-sha1` eintragen.
