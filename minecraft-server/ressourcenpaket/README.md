# Turkac – Ressourcenpaket

![Status](https://img.shields.io/badge/Status-Beta-orange) ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.11-green)

Das Server-Ressourcenpaket für meinen Minecraft-Server **Turkac RP**. Der Server lädt es beim Betreten automatisch herunter.

## Was drin ist

| Teil | Beschreibung |
|------|--------------|
| 🌙 Dark Mode | [Default Dark Mode](https://github.com/nebuIr/Default-Dark-Mode) von nebulr (CC BY-NC-SA 4.0): alle Menüs, Inventare und Buttons dunkel. Der Text-Shader ist an 1.21.11 angepasst, damit Menütitel hell und lesbar bleiben. |
| 🔊 Sounds | Kurze, saubere Menü-Sounds im Stil „Studio“ aus [UI SFX](https://github.com/romainsimon/uisfx) (CC0): `turkac:ui.click`, `ui.open`, `ui.close`, `ui.page`, `ui.buy`, `ui.success`, `ui.error`. `ui.teleport` nutzt den Minecraft-Enderman-Sound, `ui.jump` ist stumm. |
| 🪪 Personalausweis | Eigene Textur für Papier mit `custom_model_data` = `turkac:personalausweis`. |
| 🤵 Anzug | Schwarzer Anzug aus Lederrüstung: Sakko mit weißem Hemd, dünner Krawatte und Einstecktuch, Hose mit Gürtel, schwarze Schuhe. Nutzt `item_model` + `equippable` – normale Lederrüstung bleibt unverändert. |
| 👔 Kleidungs-Update | 17 eigene Outfits (Smoking, Nadelstreifen, Gold VIP, Trainingsanzug, Hoodie, Biker, Polizei, SWAT, Feuerwehr, Rettungsdienst, Mechaniker, Koch, Pirat, weißer und schwarzer Anzug, 20er-Look, klassischer Anzug mit Hut) und 14 Kopfbedeckungen. Dateien heißen `kl_*`, werden über den `/shop` im Turkac-Plugin verkauft. |
| 🛡️ Team-Outfits | Jacke, Hose und Schuhe für **Admins (rot)** und **Supporter (blau)**: Schriftzug ADMIN/SUPPORT auf dem Rücken, Abzeichen auf der Brust, farbige Armbinde, Streifen und Sohlen. Unzerstörbar. |

## Anzug geben

`minecraft:` davor ist wichtig, sonst nimmt Essentials seinen eigenen `/give`, der keine Komponenten kann.

```
/minecraft:give @p leather_chestplate[item_model="turkac:anzug_jacke",equippable={slot:"chest",asset_id:"turkac:anzug"},item_name="Anzug-Jacke",lore=[{text:"Turkac Schneiderei",color:"gray",italic:false}]]
/minecraft:give @p leather_leggings[item_model="turkac:anzug_hose",equippable={slot:"legs",asset_id:"turkac:anzug"},item_name="Anzug-Hose",lore=[{text:"Turkac Schneiderei",color:"gray",italic:false}]]
/minecraft:give @p leather_boots[item_model="turkac:anzug_schuhe",equippable={slot:"feet",asset_id:"turkac:anzug"},item_name="Anzug-Schuhe",lore=[{text:"Turkac Schneiderei",color:"gray",italic:false}]]
```

## Sounds benutzen (z. B. in DeluxeMenus)

```yaml
- '[console] execute at %player_name% run playsound turkac:ui.click master %player_name% ~ ~ ~ 0.8 1'
```

## Aufbau

- `TurkacRP-Pack.zip` – das fertige Paket (wird vom Server geladen)
- `quelle/` – der entpackte Inhalt zum Bearbeiten

Nach jeder Änderung neu zippen und in der `server.properties` die neue `resource-pack-sha1` eintragen.


## Team-Outfits geben

**Admin**
```
/minecraft:give @p leather_chestplate[item_model="turkac:admin_jacke",equippable={slot:"chest",asset_id:"turkac:admin"},item_name={text:"Admin-Jacke",color:"red",bold:true},unbreakable={}]
/minecraft:give @p leather_leggings[item_model="turkac:admin_hose",equippable={slot:"legs",asset_id:"turkac:admin"},item_name={text:"Admin-Hose",color:"red",bold:true},unbreakable={}]
/minecraft:give @p leather_boots[item_model="turkac:admin_schuhe",equippable={slot:"feet",asset_id:"turkac:admin"},item_name={text:"Admin-Schuhe",color:"red",bold:true},unbreakable={}]
```

**Supporter**
```
/minecraft:give @p leather_chestplate[item_model="turkac:support_jacke",equippable={slot:"chest",asset_id:"turkac:support"},item_name={text:"Supporter-Jacke",color:"blue",bold:true},unbreakable={}]
/minecraft:give @p leather_leggings[item_model="turkac:support_hose",equippable={slot:"legs",asset_id:"turkac:support"},item_name={text:"Supporter-Hose",color:"blue",bold:true},unbreakable={}]
/minecraft:give @p leather_boots[item_model="turkac:support_schuhe",equippable={slot:"feet",asset_id:"turkac:support"},item_name={text:"Supporter-Schuhe",color:"blue",bold:true},unbreakable={}]
```
