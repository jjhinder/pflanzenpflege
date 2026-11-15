# Pflanzenpflege

Eine Web-App für Zimmerpflanzen, die man aufs Handy installieren kann (PWA):

- **Heute**: Aufgaben pro Tag gebündelt (Giessen, Düngen, Foto-Check), nach Raum gruppiert, mit Kalender für die nächsten 4 Monate
- **Pflanzen**: Sammlung mit Fotos und schwarz-weissen botanischen Skizzen, Feuchtigkeitsanzeige, Verlauf und Gesundheitskurve pro Pflanze
- **Pflanzendoktor**: Diagnose aus Fotos und Beschreibung, mit passenden Produkten von feey
- **Neu**: Pflanzenfinder für deinen Standort und Anleitung nach dem Kauf (erste Wochen, Umtopfen, Erde)
- **Ferien**: Giessplan für die Vertretung, als Text kopierbar
- **Verlauf**: Was wann gemacht wurde, Statistik, Einstellungen, Sicherung und Import

Die Daten liegen im Browser des jeweiligen Geräts (IndexedDB). Über «Verlauf → Einstellungen» kannst du eine Sicherung herunterladen und auf einem anderen Gerät wieder einlesen.

## Online stellen mit Vercel (kostenlos)

1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden.
2. [Dieses Repo importieren](https://vercel.com/new/clone?repository-url=https://github.com/jjhinder/pflanzenpflege&env=ANTHROPIC_API_KEY,APP_PASSWORD) (oder «Add New → Project» und `pflanzenpflege` wählen). Framework: «Other», sonst nichts ändern.
3. Unter «Environment Variables» zwei Werte eintragen, wenn du die KI-Funktionen willst:
   - `ANTHROPIC_API_KEY`: ein Schlüssel von [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - `APP_PASSWORD`: ein frei gewähltes Passwort. Ohne dieses Passwort kann niemand über deine App deinen Schlüssel verbrauchen.
4. «Deploy» drücken. Nach etwa einer Minute bekommst du eine Adresse wie `https://pflanzenpflege-xyz.vercel.app`.
5. Die Adresse auf dem Handy öffnen:
   - **iPhone**: in Safari «Teilen» → «Zum Home-Bildschirm»
   - **Android**: im Chrome-Menü «App installieren»
6. In der App unter «Verlauf → Einstellungen» das App-Passwort eingeben.

Jeder Push auf `main` wird automatisch neu veröffentlicht.

Ohne die zwei Umgebungsvariablen funktioniert alles ausser Skizzen, Pflanzendoktor, Foto-Erkennung, Pflegevorschlägen und Pflanzenfinder.

### Kosten der KI

Die KI-Anfragen laufen über deinen Anthropic-Schlüssel und werden dort nach Verbrauch abgerechnet. Standardmodell ist `claude-opus-5-5`. Eine Skizze ist die grösste Anfrage (viel SVG-Code) und kostet ein paar Rappen bis etwa 40 Rappen, eine Diagnose deutlich weniger. Mit der Umgebungsvariable `CLAUDE_MODEL` (z. B. `claude-sonnet-5-5`) kannst du ein günstigeres Modell wählen.

## Teilen

Die Adresse kannst du einfach weitergeben. Jede Person hat ihre eigenen Pflanzen in ihrem eigenen Browser. Die KI-Funktionen kann nur nutzen, wer das App-Passwort kennt.

## Lokal starten

```bash
npm install
ANTHROPIC_API_KEY=... APP_PASSWORD=... npm run dev
# http://localhost:3000
```

## Aufbau

| Datei | Zweck |
| --- | --- |
| `public/index.html` | Seite, Navigation, Einbindung |
| `public/app.css` | Design (hell und dunkel, Grün nur für Akzente) |
| `public/app.js` | Die ganze App-Logik und Ansichten |
| `public/runtime.js` | Speicherung im Browser (IndexedDB), Fotos, Sicherung, Verbindung zur KI |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icons/` | Installierbar und offline nutzbar |
| `api/claude.js` | Serverfunktion, die Anfragen mit deinem Schlüssel an Claude weiterreicht |
| `dev-server.mjs` | Lokaler Testserver |
