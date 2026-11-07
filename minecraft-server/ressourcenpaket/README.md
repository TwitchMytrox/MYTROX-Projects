# Turkac – Ressourcenpaket

![Status](https://img.shields.io/badge/Status-Beta-orange) ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.11-green)

Das Server-Ressourcenpaket für meinen Minecraft-Server **Turkac RP**. Der Server lädt es beim Betreten automatisch herunter.

## Was drin ist

| Teil | Beschreibung |
|------|--------------|
| 🌙 Dark Mode | Alle Container-Menüs (Truhen, Inventar, Öfen, Shops, DeluxeMenus …), Buttons und das Rezeptbuch in dunklem Grau. Ein kleiner Text-Shader macht die dunkelgrauen Menü-Titel hell, damit sie lesbar bleiben. |
| 🔊 Sounds | Kurze, saubere Menü-Sounds im Stil „Studio“ aus [UI SFX](https://github.com/romainsimon/uisfx) (CC0): `turkac:ui.click`, `ui.open`, `ui.close`, `ui.page`, `ui.buy`, `ui.success`, `ui.error`. `ui.teleport` nutzt den Minecraft-Enderman-Sound, `ui.jump` ist stumm. |
| 🪪 Personalausweis | Eigene Textur für Papier mit `custom_model_data` = `turkac:personalausweis`. |

## Sounds benutzen (z. B. in DeluxeMenus)

```yaml
- '[console] execute at %player_name% run playsound turkac:ui.click master %player_name% ~ ~ ~ 0.8 1'
```

## Aufbau

- `TurkacRP-Pack.zip` – das fertige Paket (wird vom Server geladen)
- `quelle/` – der entpackte Inhalt zum Bearbeiten

Nach jeder Änderung neu zippen und in der `server.properties` die neue `resource-pack-sha1` eintragen.
