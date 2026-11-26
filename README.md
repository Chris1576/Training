# Trainingslog

Persönlicher Trainingslog für einen Pull / Push / Leg-Plan. Läuft als Web-App auf Railway
(`https://trainingslog-production.up.railway.app`) und gleicht alle Geräte über den Server ab.

## Funktionen

- Premium-Design (Schwarz, Kupfergold-Akzent), Navigation unten: Training, Verlauf, Rekorde, Plan
- Übungen hinzufügen – aus der Bibliothek (u. a. CrossFit, Olympisch, Kettlebell, Turnen, Cardio) oder selbst
  angelegt, „nur heute“ oder dauerhaft im Plan
- Plan bearbeiten: sortieren, Sätze / Zielbereich / Pause / Aufwärmen ändern, entfernen, Standardplan wiederherstellen
- Gewichtsvorschlag nach doppelter Progression, Werte vom letzten Mal als Platzhalter
- Abschluss-Übersicht: Sätze, Volumen, Dauer, neue Bestwerte, Vergleich zur letzten Einheit
- Verlauf: Kalender, Wochenziel, Serie, Diagramm (Gewicht / 1RM / Volumen)
- Rekorde je Übung inklusive geschätztem 1RM (Epley), Feuerwerk bei neuem Rekord

## Aufbau

- `server.js` – Express-Server: liefert die App aus, schützt alles per Login (`AUTH_USER` / `AUTH_PASS`)
  und speichert unter `GET/PUT /api/data` in `DATA_FILE` (Standard `data/Training.json`).
  Einheiten werden zusammengeführt, beim Trainingsplan gewinnt der neuere Stand.
- `index.html` – die App, eine einzelne Datei ohne Build-Schritt
- `icons/`, `manifest.webmanifest` – Logo, Favicon und App-Manifest (ohne Login abrufbar)
- `tools/make-icons.ps1` – erzeugt alle Icons neu
- `tools/make-shortcut.ps1` – legt unter Windows die Verknüpfung „Trainingslog“ an (Desktop, Startmenü,
  Projektordner)
- `worker.js` – älterer Sync über einen Cloudflare Worker, wird nicht mehr genutzt

## Lokal starten

```powershell
npm install
$env:AUTH_USER="name"; $env:AUTH_PASS="passwort"; npm start
```

Danach `http://localhost:3000` öffnen.

## Deployment

Push auf `main` aktualisiert Railway über den GitHub-Webhook; zusätzlich direkt mit `railway up`
(Service `trainingslog`, Environment `production`).
