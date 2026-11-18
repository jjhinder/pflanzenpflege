# Pflanzenpflege

Eine Web-App für Zimmerpflanzen, die man aufs Handy installieren kann (PWA):

- **Heute**: Aufgaben pro Tag gebündelt (Giessen, Düngen, Foto-Check), nach Raum gruppiert, mit Kalender für die nächsten 4 Monate
- **Pflanzen**: Sammlung mit Fotos und schwarz-weissen botanischen Skizzen, Feuchtigkeitsanzeige, Verlauf und Gesundheitskurve pro Pflanze
- **Pflanzendoktor**: Diagnose aus Fotos und Beschreibung, mit passenden Produkten von feey
- **Neu**: Pflanzenfinder für deinen Standort und Anleitung nach dem Kauf (erste Wochen, Umtopfen, Erde)
- **Ferien**: Giessplan für die Vertretung, als Text kopierbar
- **Verlauf**: Was wann gemacht wurde, mit Statistik
- **Profil** (rundes Symbol oben rechts): Erinnerungen, Pflegeplan, Haushalt, KI-Zugang mit Kostenübersicht, Konto, Sicherung und Import
- **Erinnerungen**: Jeden Morgen eine Push-Nachricht, wenn etwas zu giessen, düngen oder umtopfen ist (iPhone: ab iOS 16.4, App auf dem Home-Bildschirm)
- **Smarter Giessplan**: Intervalle passen sich der Jahreszeit an (im Winter länger, Düngepause November bis Februar), und die App schlägt ein anderes Intervall vor, wenn ihr regelmässig früher oder später giesst
- **Umtopfen und Ableger**: Erinnerung zum Umtopfen im Frühling, Ableger als eigene Pflanzen (im Wasserglas mit wöchentlichem Wasserwechsel)
- **Foto-Zeitstrahl**: Alle Fotos einer Pflanze nach Datum; zwei Fotos nebeneinander vergleichen, auch durch den Pflanzendoktor

- **Haushalte**: Mehrere Personen teilen dieselben Pflanzen, jede mit eigenem Konto und Gerät. Im Verlauf steht, wer was gemacht hat.

Die Pflanzen liegen zentral auf dem Server (Upstash Redis) und gehören einem Haushalt. Jede Person meldet sich mit Benutzername und Passwort an und sieht die Pflanzen ihres Haushalts auf jedem Gerät. Eine Kopie bleibt im Browser, damit die App auch ohne Verbindung startet. Zum Abhaken braucht es eine Verbindung.

Für die KI-Funktionen hinterlegt **jeder Haushalt seinen eigenen Anthropic-API-Schlüssel** und bezahlt seine Anfragen selbst. Der Schlüssel liegt verschlüsselt auf dem Server und geht nie zurück an den Browser.

## Online stellen mit Vercel (kostenlos)

1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden.
2. [Dieses Repo importieren](https://vercel.com/new/clone?repository-url=https://github.com/jjhinder/pflanzenpflege) (oder «Add New → Project» und `pflanzenpflege` wählen). Framework: «Other», sonst nichts ändern.
3. **Speicher anlegen**: Im Vercel-Projekt auf «Storage» → «Create Database» (Marketplace) → **Upstash for Redis** → Gratis-Plan, Region Frankfurt (`eu-central-1`) → mit dem Projekt verbinden. Vercel trägt dabei `KV_REST_API_URL` und `KV_REST_API_TOKEN` selbst ein.
4. Unter «Settings → Environment Variables» (alle freiwillig, aber empfohlen):
   - `APP_SECRET`: eine lange Zufallszeichenkette, z. B. aus `openssl rand -base64 32`. Damit werden die API-Schlüssel der Haushalte verschlüsselt. Fehlt sie, wird der Redis-Token dafür verwendet. **Später nicht mehr ändern**, sonst müssen alle Haushalte ihren Schlüssel neu eintragen.
   - `SIGNUP_CODE`: ein Code, den man für einen neuen Haushalt braucht. So können nur Leute, denen du den Code gibst, Konten anlegen. Wer per Einladung einem bestehenden Haushalt beitritt, braucht ihn nicht.
   - `CLAUDE_MODEL`: anderes Modell als `claude-opus-5-5`, z. B. `claude-sonnet-5-5` (günstiger).
   - `CLAUDE_SKETCH_MODEL`: Modell für die Skizzen, Standard wie `CLAUDE_CHEAP_MODEL`.
   - `CLAUDE_CHEAP_MODEL`: Modell für Skizzen, Foto-Erkennung und Pflegevorschläge, Standard `claude-haiku-5-5`.
   - `CLAUDE_MID_MODEL`: Modell für Pflanzenfinder und Anleitungen, Standard `claude-sonnet-5-5`.
   - Pflanzendoktor, Foto-Checks und Fotovergleiche nutzen `CLAUDE_MODEL`.
   - `CRON_SECRET`: eine lange Zufallszeichenkette. Vercel schickt sie beim täglichen Erinnerungs-Job mit, und nur dann läuft er. So kann niemand sonst die Erinnerungen auslösen.
5. «Deploy» drücken (oder nach dem Ändern der Variablen unter «Deployments» neu veröffentlichen). Nach etwa einer Minute bekommst du eine Adresse wie `https://pflanzenpflege-xyz.vercel.app`.
6. Die Adresse auf dem Handy öffnen und ein Konto erstellen:
   - **iPhone**: in Safari «Teilen» → «Zum Home-Bildschirm»
   - **Android**: im Chrome-Menü «App installieren»
7. Unter «Verlauf → Einstellungen → KI-Zugang» den eigenen Anthropic-Schlüssel eintragen ([console.anthropic.com](https://console.anthropic.com/settings/keys), Guthaben aufladen nicht vergessen).

Jeder Push auf `main` wird automatisch neu veröffentlicht.

### Erinnerungen am Morgen

- Der Job steht in `vercel.json` (`crons`) und läuft täglich um 06:00 UTC, also um etwa 7 Uhr Schweizer Zeit im Winter und 8 Uhr im Sommer. Im Gratis-Plan (Hobby) startet Vercel ihn irgendwann innerhalb dieser Stunde. Unter «Settings → Cron Jobs» im Vercel-Projekt siehst du ihn und kannst ihn von Hand starten.
- Die Schlüssel für Web Push (VAPID) erzeugt der Server beim ersten Gebrauch selbst und speichert sie verschlüsselt in Redis. Wer sie selbst festlegen will, setzt `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und optional `VAPID_SUBJECT` (`mailto:…` oder `https://…`).
- Zeitzone für «heute»: `Europe/Zurich`, änderbar mit `APP_TIMEZONE`.
- Jede Person schaltet die Erinnerungen im Profil auf ihrem eigenen Gerät ein. Auf dem iPhone geht das nur in der App vom Home-Bildschirm (iOS 16.4 oder neuer).

### Von der früheren Version umsteigen

Früher lagen die Pflanzen nur im Browser, und alle KI-Anfragen liefen über einen Schlüssel in `ANTHROPIC_API_KEY` mit `APP_PASSWORD`. Diese zwei Variablen braucht es nicht mehr, du kannst sie in Vercel löschen.

- Öffne die App auf dem Gerät, auf dem deine Pflanzen bisher waren, und erstelle ein Konto. Die App fragt dann, ob sie die Pflanzen aus diesem Browser in den Haushalt übernehmen soll (mit Fotos und Verlauf). Das geht auch später unter «Verlauf → Einstellungen».
- Oder: eine Sicherungsdatei (z. B. `meine-pflanzen.json`) unter «Verlauf → Einstellungen → Sicherung einlesen» laden.

Pflanzen, die es im Haushalt schon gibt, werden beim Übernehmen und Einlesen nicht überschrieben.

## Haushalte

- Wer ein neues Konto erstellt, gründet damit einen eigenen Haushalt.
- Unter «Verlauf → Einstellungen → Haushalt» erzeugt «Person einladen» einen Einladungslink mit Code (7 Tage gültig). Wer den Link öffnet und ein Konto erstellt, ist sofort im selben Haushalt.
- Wer schon ein Konto hat, kann unter «Einem anderen Haushalt beitreten» den Code eingeben. War die Person allein in ihrem alten Haushalt, nimmt sie ihre Pflanzen mit.
- Der Anthropic-Schlüssel gilt für den ganzen Haushalt. Freunde mit eigenem Haushalt tragen ihren eigenen Schlüssel ein und bezahlen ihre Anfragen selbst.

### Kosten der KI

Die KI-Anfragen laufen über den Anthropic-Schlüssel des Haushalts und werden dort nach Verbrauch abgerechnet. Standardmodell ist `claude-opus-5-5`. Eine Skizze ist die grösste Anfrage (viel SVG-Code) und kostet ein paar Rappen bis etwa 40 Rappen, eine Diagnose deutlich weniger.

### Grenzen des Gratis-Speichers

Der Gratis-Plan von Upstash reicht für ein paar Haushalte gut (laut Upstash 256 MB Daten und 500 000 Befehle im Monat, aktuelle Werte auf upstash.com/pricing). Am meisten Platz brauchen Fotos: Die App verkleinert sie auf höchstens 1400 Pixel, ein Foto braucht dann etwa 150 bis 300 KB. Pro Haushalt sind höchstens 3000 Fotos und 2000 Einträge erlaubt.

### Fotos und Speicherplatz

Fotos liegen wie alles andere in Upstash Redis. Das reicht für einen Haushalt mit einigen Dutzend Pflanzen und regelmässigen Fotos ein bis zwei Jahre (ein Foto braucht in Redis etwa 200 bis 400 KB, der Gratis-Plan hat 256 MB). Im Profil unter «Daten» steht, wie viel Platz die Fotos belegen, und im Foto-Zeitstrahl lassen sich alte Fotos löschen. Wird es knapp, wäre der nächste Schritt, die Fotos in Vercel Blob auszulagern.

### Kostenübersicht

Nach jeder KI-Anfrage schreibt der Server die gemeldeten Tokens und die geschätzten Kosten (Listenpreise von Anthropic, siehe `lib/usage.js`) pro Haushalt und Monat mit. Die Übersicht im Profil zeigt diesen und den letzten Monat, aufgeteilt nach Funktion. Erfasst wird erst ab dieser Version.

## Lokal starten

```bash
npm install
npm run dev
# http://localhost:3000
```

Ohne `KV_REST_API_URL` und `KV_REST_API_TOKEN` liegen die Daten nur im Arbeitsspeicher und sind nach einem Neustart weg. Zum Testen reicht das.

## Aufbau

| Datei | Zweck |
| --- | --- |
| `public/index.html` | Seite, Navigation, Einbindung |
| `public/app.css` | Design (hell und dunkel, Grün nur für Akzente) |
| `public/app.js` | Die ganze App-Logik und Ansichten |
| `public/runtime.js` | Anmeldung, Abgleich mit dem Server, Kopie für offline, Fotos, Sicherung, Übernahme alter Daten, Verbindung zur KI |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icons/` | Installierbar und offline nutzbar |
| `api/auth.js` | Konto erstellen, anmelden, abmelden, Passwort ändern |
| `api/household.js` | Haushalt: einladen, beitreten, verlassen, umbenennen, Anthropic-Schlüssel |
| `api/data.js` | Pflanzen und Einstellungen des Haushalts lesen und schreiben |
| `api/photo.js` | Fotos des Haushalts |
| `api/claude.js` | Reicht KI-Anfragen mit dem Schlüssel des Haushalts an Claude weiter und schreibt die Kosten mit |
| `api/push.js` | Erinnerungen auf einem Gerät ein- und ausschalten, Probe-Nachricht |
| `api/cron.js` | Täglicher Job, der die Erinnerungen verschickt |
| `public/schedule.js` | Pflegeplan (Giessen, Düngen, Umtopfen, Jahreszeit), gemeinsam für App und Server |
| `lib/` | Gemeinsamer Code der Serverfunktionen (Redis, Sitzungen, Verschlüsselung) |
| `dev-server.mjs` | Lokaler Testserver |
