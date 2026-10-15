# VARTA.iq Azure Viewer

Eigenständiger Docker-Uploader für einen VARTA.iq Energy Manager mit privater Azure-Website und eigener Benutzerverwaltung. Der bisherige lokale Viewer bleibt im separaten Repository [varta.iq-viewer](https://github.com/kko/varta.iq-viewer).

Der Collector liest `/v2/point` und `/v2/devices` alle zehn Sekunden über geprüftes HTTPS. Er speichert Pakete vor dem Versand dauerhaft, puffert bei Ausfällen bis zu 30 Tage und lädt nach Wiederherstellung nach. Die lokale Verwaltungsoberfläche zeigt Einstellungen, getrennte Verbindungszustände und die letzten zehn Fehler.

Azure speichert Messwerte und Aggregate in Table Storage. Static Web Apps Free stellt die Website und die Node.js-22-API bereit. Ein unabhängiger Automation-Runbook bereinigt täglich die Daten außerhalb der letzten 365 UTC-Kalendertage sowie abgelaufene Sitzungen.

## Docker-Collector starten

Docker Engine mit Linux-Containern und Compose v2 installieren. Unterstützt werden x64, ARM64 und ARMv7; auf einem ARMv7-Raspberry-Pi wurde der Container gebaut und betrieben.

```sh
git clone https://github.com/kko/varta.iq-azure-viewer.git
cd varta.iq-azure-viewer
docker compose -f compose.collector.yaml up -d --build
```

Verwaltung: [http://localhost:8788](http://localhost:8788). Für den Zugriff im Heimnetz `.env.example` nach `.env` kopieren und `COLLECTOR_ALLOWED_HOSTS` um die IP oder den Hostnamen des Docker-Rechners mit `:8788` ergänzen. Auf dem Pi gegebenenfalls `sudo docker compose …` verwenden.

Die lokale Oberfläche verwendet auf Wunsch HTTP ohne Passwort. Dort Gateway-IP, VARTA-API-Key, Azure-Upload-Adresse, Collector-ID und Upload-Schlüssel eintragen, Verbindungen testen und Upload aktivieren. Der Zugriff auf diese Oberfläche gehört ins vertrauenswürdige Heimnetz. Konfiguration und Puffer liegen in eigenen Docker-Volumes; `down -v` löscht sie.

## Azure einrichten

Voraussetzungen: PowerShell 7.2+, Azure CLI, Node.js 22.9+ mit npm/npx und passende Bereitstellungs- sowie Rollenzuweisungsrechte im ausgewählten Abonnement.

```powershell
az login
./scripts/setup-azure.ps1 -SubscriptionId '<Abonnement-ID>'
```

Das wiederholbar ausführbare Skript veröffentlicht Infrastruktur, Website und API, richtet die tägliche Bereinigung ein und gibt die Upload-Konfiguration sowie den geheimen Einrichtungslink aus. Vorhandene Upload-Schlüssel und Benutzer bleiben erhalten. Speicher- und Transaktionskosten können entstehen; eine vollständig kostenlose Gesamtlösung wird nicht zugesichert.

## Benutzerverwaltung

1. Den persönlichen Einrichtungslink öffnen. Im einmaligen Formular Benutzername, E-Mail und ein eigenes Passwort mit mindestens 15 Zeichen eintragen. Damit entsteht der erste Administrator.
2. Danach mit Benutzername oder E-Mail anmelden. Der Einrichtungslink kann keinen weiteren Administrator mehr anlegen; es gibt keine öffentliche Selbstregistrierung.
3. Unter **Benutzerkonto** weitere Betrachter oder Administratoren anlegen, Rollen ändern, Konten sperren oder Startpasswörter zurücksetzen. Weitere Benutzer müssen ihr Startpasswort vor dem Datenzugriff ändern.

Die Daten-APIs prüfen jede Sitzung serverseitig. Passwort-Hashes verwenden individuelle Salts und PBKDF2-HMAC-SHA256 mit 600.000 Iterationen. Sitzungscookies sind Secure, HttpOnly und SameSite=Strict und laufen nach acht Stunden ab. Passwort- oder Rollenänderungen und Sperren beenden vorhandene Sitzungen; Anmeldeversuche sind persistent begrenzt. Der letzte aktive Administrator kann nicht gesperrt oder herabgestuft werden. Die Collector-Uploads verwenden unabhängig davon ihren Upload-Schlüssel.

Es wird keine Microsoft-Organisationsfreigabe benötigt. E-Mail-Adressen sind Anmeldenamen; E-Mail-Versand, MFA und automatische E-Mail-Passwortwiederherstellung sind derzeit nicht eingerichtet. Für größere oder besonders sensible Anwendungen ist ein verwalteter Identitätsanbieter vorzuziehen.

## Entwicklung und Prüfung

```sh
npm ci
npm ci --prefix cloud/api
npm test
npm run test:storage
npx playwright install chromium
npm run test:ui
npm run acceptance -- --accelerated
```

Die TLS-Tests benötigen OpenSSL. Die Storage-Integration startet einen lokalen Azurite-Emulator; Browserprüfungen verwenden Playwright. Alle Tests verwenden Testdaten. Mit `npm run prepare:cloud` entsteht die veröffentlichbare Website unter `cloud/site`; dieser Ordner wird nicht versioniert.

Die Quelltexte unter `public/` sind die aus dem lokalen Viewer übernommenen Darstellungskomponenten und die Vorlage für den Cloud-Build. Dieses Repository startet ausschließlich den Collector; ein zweiter lokaler Viewer-Server ist nicht enthalten.

Vollständige Anleitung, Schnittstellen, Kostenmodell, Aufbewahrung und Abnahme: [COLLECTOR.md](COLLECTOR.md). Ein kleines Docker-Bauarchiv lässt sich mit `npm run package:uploader` erzeugen. Gespeicherte Schlüssel, Konfiguration, Messdaten und Puffer gehören nicht ins Repository.

Lizenz: [Apache 2.0](LICENSE).

Die lokale Collector-Verwaltung bietet oben eine Dropdown-Auswahl für Deutsch und Englisch. Sie übersetzt Einstellungen, Status und bekannte Fehlermeldungen und speichert die Sprachwahl nur im jeweiligen Browser. Ungespeicherte Eingaben bleiben beim Umschalten erhalten.
