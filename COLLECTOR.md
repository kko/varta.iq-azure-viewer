# VARTA.iq Collector und Azure

Dieses Repository enthält den eigenständigen Collector und die Azure-Website. Er liest die beiden lokalen VARTA-Endpunkte alle zehn Sekunden, puffert Pakete auf dem Docker-Host und lädt sie in eine durch Benutzerkonten geschützte Azure-Website. Die Website nutzt die vorhandenen Kennzahlen, Geräteansichten, Original-JSON-Anzeigen und Diagramme. Der separate lokale Viewer bleibt im Repository https://github.com/kko/varta.iq-viewer.

## Voraussetzungen

- Docker Engine mit Linux-Containern und Compose v2 auf PC, NAS oder Raspberry Pi; Images unterstützen x64, ARM64 und ARMv7. Für den plattformübergreifenden Build ist Docker Buildx erforderlich.
- Für die Einrichtungsskripte: PowerShell 7.2 oder neuer. PowerShell läuft auch unter Linux; alternativ sind die Docker-Befehle unten direkt verwendbar.
- Für Azure: Azure CLI, Node.js 22 mit npm/npx und ein angemeldetes Azure-Konto (`az login`). Das Konto benötigt Rechte zum Erstellen der Ressourcen und zum Zuweisen der Speichertabellen-Rolle an die Automation-Identität, z. B. Contributor plus Role Based Access Control Administrator am passenden Scope.
- Die lokale VARTA-API muss aktiviert sein. Zertifikatsprüfung und das bereits hinterlegte Gateway-Zertifikat werden unverändert verwendet.

## 1. Azure einrichten

```powershell
az login
./scripts/setup-azure.ps1 -SubscriptionId '<Abonnement-ID>'
```

Optionale Parameter: `-ResourceGroup`, `-Location` (Standard `westeurope`), `-SiteName`, `-StorageName`, `-AutomationName`, `-CollectorId` und `-PacketSamplePath`. Das Skript registriert fehlende Ressourcenanbieter (dafür sind Abonnementrechte erforderlich), verwendet deterministische Standardnamen, erhält einen vorhandenen Upload-Schlüssel und erstellt die Ressourcen erneut ausführbar per Bicep. Es installiert die fixierten API-Abhängigkeiten, erzeugt die Website aus dem aktuellen lokalen Viewer und veröffentlicht Frontend plus integrierte API mit der SWA CLI.

Am Ende werden Website-Adresse, Upload-Adresse, Collector-ID und Upload-Schlüssel ausgegeben. Nur diese Upload-Daten werden später im Collector benötigt. Azure-Abonnement-Zugangsdaten gehören nicht in dessen Oberfläche. Den Schlüssel mit `-RotateUploadKey` ausdrücklich erneuern und anschließend im Collector ersetzen. Schlüssel niemals mit dem Deployment-Token der Static Web App verwechseln.

Öffne nach dem Deployment den ausgegebenen geheimen Einrichtungslink. Ein einmaliges Formular legt den ersten Administrator mit Benutzername, E-Mail und eigenem Passwort (15–128 Zeichen) an. Das bekannte Standardpasswort wird nicht akzeptiert. Der Link verliert nach Abschluss seine Wirkung. Danach meldest du dich über Benutzername oder E-Mail an. Administratoren können unter „Benutzerkonto“ weitere Betrachter oder Administratoren anlegen, sperren, Rollen ändern und Passwörter zurücksetzen. Startpasswörter für weitere Benutzer müssen vor jedem Datenzugriff geändert werden. Es gibt keine offene Selbstregistrierung und keinen E-Mail-Versand. Eine Entra-Administratorfreigabe ist nicht erforderlich. Der Upload bleibt unabhängig davon durch seinen Schlüssel geschützt.

## 2. Collector bauen und einrichten

Beispiel für einen Docker-Host mit dem Namen `varta-pi.local` und der IP `192.168.4.15`:

```powershell
./scripts/setup-collector.ps1 -Hostnames varta-pi.local,192.168.4.15 -Start
```

Das Skript ergänzt nur die Collector-Einträge in `.env` und baut das Image. Die lokale Oberfläche verwendet standardmäßig HTTP auf Port 8788 und öffnet sich ohne Passwort oder Anmeldung. Falls `collector-config/settings.json` vorhanden ist, übernimmt das Skript daraus VARTA- und Azure-Einstellungen einschließlich Upload-Schalter per Standardeingabe. Die Datei wird nicht ins Image aufgenommen. Ein anderer Importpfad ist über `-ImportSettings` wählbar.

Alternativ ohne PowerShell vor dem Build diese Einträge in die vorhandene `.env` aufnehmen, Adressen entsprechend ersetzen:

```dotenv
COLLECTOR_ALLOWED_HOSTS=localhost:8788,127.0.0.1:8788,varta-pi.local:8788,192.168.4.15:8788
COLLECTOR_TLS_HOSTS=localhost,127.0.0.1,varta-pi.local,192.168.4.15
```

```sh
docker compose -f compose.collector.yaml build
docker compose -f compose.collector.yaml run --rm --no-deps collector node collector/setup.mjs
docker compose -f compose.collector.yaml up -d
```

Öffne `http://varta-pi.local:8788` direkt ohne Anmeldung. Für lokalen Zugriff auf demselben Host ist die Adresse `http://localhost:8788`. Der VARTA-Abruf und der Azure-Upload verwenden weiterhin geprüftes HTTPS.

Optional bleibt lokales HTTPS verfügbar: `COLLECTOR_HTTPS=true` in `.env` ergänzen und den Setup-Befehl erneut ausführen. Dann erzeugt das Setup ein lokales Zertifikat für `COLLECTOR_TLS_HOSTS`, und die Oberfläche ist unter `https://varta-pi.local:8788` erreichbar. Das Zertifikat liegt im Konfigurationsvolume als `tls.crt`; auf dem eigenen Host lässt es sich beispielsweise mit `docker compose -f compose.collector.yaml cp collector:/app/config/tls.crt ./collector-config/collector.crt` exportieren. Du kannst `tls.crt`/`tls.key` durch ein selbst verwaltetes Zertifikat ersetzen. Das Setup ersetzt vorhandene Zertifikate nicht. Bei geänderten Hostnamen ein passendes neues Zertifikat installieren.

Im Formular zuerst VARTA-IP und API-Key speichern und **VARTA testen**. Anschließend Azure-Upload-Adresse, Collector-ID und Upload-Schlüssel aus Schritt 1 speichern und **Azure testen**. Schließlich den Upload aktivieren. Ein leer gelassenes Schlüsselfeld behält den gespeicherten Schlüssel. Geänderte Zieladressen erfordern einen neuen passenden Schlüssel. Der Upload ist bis zur vollständigen Konfiguration deaktiviert; die Erfassung und Pufferung laufen bereits.

Ein gemeinsames Image mit mehreren Architekturen kann mit einer eigenen Registry gebaut werden:

```sh
docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 -f collector/Dockerfile -t REGISTRY/varta-collector:VERSION --push .
```

## Betrieb und Daten

- Eigene Volumes `collector-config` und `collector-data` erhalten Einstellungen, optionale Zertifikate, Paketpuffer und Fehlerliste über Neustarts/Rebuilds. `docker compose down -v` löscht diese Daten. Geheimnisse liegen serverseitig, werden nie von den Einstellungs-APIs zurückgegeben und sind nicht im Image oder Git enthalten.
- Nach jedem Abruf wird ein Paket dauerhaft geschrieben; nur explizit bestätigte Paket-IDs werden gelöscht. Neue Pakete werden bevorzugt, Rückstände mit bis zu 20 Paketen je Anfrage nachgeliefert. Der Upload hat 20 Sekunden Zeitlimit, folgt keinen Weiterleitungen und wiederholt Fehler mit begrenztem Backoff. Alte Pakete beeinflussen den aktuellen Live-Status nicht.
- Der Puffer hält maximal 30 Tage. Danach werden Pakete beim nächsten Erfassungs-/Startlauf gelöscht und gezählt. Ausfallzeiten des Collectors selbst lassen sich nicht nachträglich beim Gateway abrufen. Bei vollem Datenträger erscheint ein Pufferfehler; Betriebssystemspeicher und freien Platz überwachen. Bei vier Kilobyte je Paket sind 30 Tage etwa ein GiB zuzüglich Dateisystemaufwand; der Puffer verwendet einzelne Paketdateien.
- Der lokale Status zeigt Versuche und Erfolge je Endpunkt, bestätigte aktuelle und beliebige Uploads, Messwertalter, Rückstand, Ablaufverluste und die letzten zehn Fehler. Nach 30 Sekunden ohne passenden Erfolg wird der betreffende Status veraltet. Fehler bleiben nach erfolgreicher Verbindung erhalten.
- Cloud-Rohdaten liegen in UTC-Tagestabellen `VartaYYYYMMDD`. Doppelte Messzeitpunkte zählen je Collector nur einmal. Rohmesswert und Aggregate für fünf Minuten, Stunden und Tage werden per ETag-geschützter Transaktion gespeichert. Metadaten enthalten die zuletzt erfolgreich gelieferten Originalantworten.
- **365 UTC-Kalendertage einschließlich heute** bleiben erhalten. Der Automation-Runbook läuft unabhängig vom Collector täglich um 03:00 UTC, löscht ältere Tagestabellen und abgelaufene Metadaten. Die Managed Identity hat Storage Table Data Contributor nur am dedizierten Speicherkonto. Rollenzuweisungen können anfangs einige Minuten benötigen. Bereinigungsstatus und eine Warnung nach 36 Stunden ohne Lauf erscheinen auf der Cloud-Website; Details stehen unter Automation → Jobs.
- Die Cloud-Website bietet Stunde, sechs Stunden, Tag, Woche, 30 Tage, Jahr und freie Datumswahl. Freie Datumseingaben verwenden die Browser-Zeitzone; Diagramme zeigen Europe/Berlin. Die API nutzt für diese Bereiche 10 Sekunden, 1 Minute, 5 Minuten, 1 Stunde oder 1 Tag. Randbereiche freier Intervalle werden exakt aus Rohdaten berechnet. Eine Mittelung überbrückt keine leeren Diagrammzeitfenster, zeigt aber Ausfälle innerhalb eines einzelnen Mittelungsfensters nicht gesondert.
- Vorhandene lokale JSONL-Historien werden nicht automatisch importiert. Collector-ID und vorhandene Azure-Zieladresse lassen sich erst mit leerem Puffer ändern.

```sh
docker compose -f compose.collector.yaml ps
docker compose -f compose.collector.yaml logs -f
docker compose -f compose.collector.yaml down
```

Die lokale Oberfläche benötigt kein Administratorpasswort. Der Setup-Lauf entfernt gegebenenfalls übrig gebliebene lokale `admin.json`- und `bootstrap.txt`-Dateien früherer Versionen.

## Kosten

Ein Paket alle zehn Sekunden ergibt 8.640 Pakete pro Tag beziehungsweise 259.200 in 30 Tagen. Static Web Apps nutzt den Free-Tarif. Table Storage kostet Speicher und Transaktionen; der Runbook nutzt das geteilte Automation-Freikontingent von derzeit 500 Laufzeitminuten je Abonnement und Monat. Weitere Apps im Abonnement verbrauchen dieselben Kontingente. Website-Nutzung, Nachlieferungen, Region und Paketgröße beeinflussen die Gesamtkosten.

```powershell
./scripts/estimate-cost.ps1 -PacketSamplePath ./data/point-YYYY-MM-DD.jsonl
```

Die Abschätzung liest aktuelle EUR-Retail-Tarife und zeigt die verwendeten Tarifmeter. Ohne Messdatei nimmt sie vier KiB je Paket an. Sie schätzt einen vollen Jahresspeicher mit pauschalem Zuschlag für Aggregate und 20 Operationen je Paket plus 25 Prozent Reserve. Das ist eine grobe Planung, keine Kostengarantie; bei nicht eindeutig zuordenbaren Tarifen wird keine Euro-Summe ausgegeben. Keine zusätzlichen kostenpflichtigen Logging-/Monitoring-Dienste werden eingerichtet.

## Tests und Abnahme

```sh
npm test
npm ci --prefix cloud/api
node --test tests/storage.integration.mjs
pwsh -File tests/retention.integration.ps1
pwsh -File tests/provisioning.integration.ps1
npm run acceptance -- --accelerated
npm run acceptance
```

Der Speicherintegrationstest benötigt Azurite; setze `AZURITE_TABLE_MAIN` auf dessen `dist/src/table/main.js` oder installiere es für die lokale Prüfung unter `.tools/validation`. HTTPS-Tests benötigen OpenSSL (unter Windows wird die Git-Installation automatisch gefunden). `npm test` benötigt weder Azure-Zugang noch einen laufenden Energy Manager.

Die Browserprüfung `node --test tests/ui.integration.mjs` benötigt Playwright und einen installierten Browser. `PLAYWRIGHT_MODULE` kann auf dessen `index.mjs` zeigen; `PLAYWRIGHT_CHANNEL=msedge` verwendet eine vorhandene Edge-Installation. Sie prüft Jahresansicht, eigene Zeiträume, Sprachwahl, mobile Breite und die Collector-Verwaltung mit simulierten API-Antworten.

Der Acceptance-Lauf testet standardmäßig 30 Minuten im Zehn-Sekunden-Takt mit simuliertem Gateway, persistentem Dateipuffer und einem Cloud-Speicheradapter im Arbeitsspeicher. Er simuliert einen Internetausfall und einen Collector-Neustart; `--accelerated` spielt dieselben 180 Messpunkte ohne Wartezeiten ab. Beide Varianten ersetzen keine Prüfung mit echter Hardware und bereitgestelltem Azure.

Nach Bereitstellung zusätzlich 30 Minuten mit echtem Gateway laufen lassen, Azure-Erreichbarkeit unterbrechen, Container neu starten und nach Wiederherstellung leeren Puffer sowie duplikatfreie Historie prüfen. Einen abgelaufenen Testtag ausschließlich in einer separaten Test-Ressourcengruppe anlegen; bei gestopptem Collector den Runbook ausführen und gelöschten Testtag sowie erfolgreichen Bereinigungsstatus prüfen. Einmalige Einrichtung, Anmeldung, Pflichtwechsel, Rollenrechte, Upload-Schutz, Jahresansicht und Statusalter auf Desktop und Mobilgerät prüfen.

## Schnittstellen

Die lokale Oberfläche nutzt `/api/settings` (GET/PUT), `/api/status`, `/api/test/varta` und `/api/test/azure` ohne Anmeldung. Schreibaufrufe erfordern einen freigegebenen Host, passenden Origin und JSON-Inhalt. Es gibt keine Login-/Logout-Endpunkte oder Sitzungscookies. `/healthz` prüft ausschließlich den lokalen Webserver.

Azure akzeptiert `POST /api/ingest` mit Header `X-Upload-Key`. Der Body ist ein einzelnes versioniertes Paket oder `{ "packets": [...] }` mit höchstens 20 Paketen und einem MiB pro Anfrage. Pakete enthalten `version`, `id`, `collectorId`, `createdAt`, `sourceGatewayIp` und die unabhängigen `point`-/`devices`-Abrufresultate. Bestätigte IDs stehen in `accepted`, ungültige Pakete mit Grund in `rejected`. Ein Verbindungstest sendet `{ "test": true, "collectorId": "…" }` und prüft auch einen Speicherschreibvorgang. Größen oberhalb der Table-Storage-Property-Grenze werden abgelehnt.

Die Cloud-Lese-APIs `/api/point`, `/api/devices`, `/api/status` und `/api/history?hours=…` beziehungsweise `?from=ISO&to=ISO` benötigen eine gültige Sitzung und ein bereits geändertes Startpasswort. Intervalle sind am Ende exklusiv. Weder Schlüssel noch private Gateway-Einstellungen sind über die Cloud-Lese-APIs verfügbar.

## Eigenständiges Docker-Paket

`node scripts/package-uploader.mjs` erzeugt `artifacts/varta-uploader-docker.tar.gz` ohne gespeicherte Schlüssel. Entpacken und im Paketordner `docker compose up -d --build` ausführen. Das separate Compose-Projekt `varta-uploader` enthält ausschließlich den Collector und eigene persistente Volumes. Die beiliegende Anleitung beschreibt den Import vorhandener Einstellungen. Docker Engine mit Linux-Containern und Compose v2 ist erforderlich.

## Benutzerkonten und Sitzungen

Die statischen HTML-/JS-Dateien enthalten keine Messdaten oder Schlüssel; jede Cloud-Lese-API prüft die Sitzung serverseitig. Passwörter werden mit zufälligem Salt und PBKDF2-HMAC-SHA256 (600.000 Iterationen, gemäß [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)) gespeichert. Sitzungen verwenden zufällige Tokens, deren Hash in Table Storage gespeichert wird, und Secure-/HttpOnly-/SameSite-Strict-Cookies mit acht Stunden Laufzeit. Passwortwechsel, Rücksetzungen, Sperren und Rollenänderungen machen vorhandene Sitzungen ungültig. Anmeldeversuche werden persistent begrenzt, Schreibaufrufe prüfen Origin und JSON. Der letzte aktive Administrator bleibt erhalten. Der tägliche Runbook entfernt zusätzlich abgelaufene Sitzungen und Anmeldebegrenzungen; Benutzerkonten bleiben bestehen. Es gibt derzeit keine E-Mail-Verifikation, MFA oder automatische E-Mail-Passwortwiederherstellung; die E-Mail ist ein Anmeldename. Für größere oder besonders sensible Anwendungen ist ein verwalteter Identitätsanbieter vorzuziehen.

Der lokale Uploader läuft auf dem Pi unter `/home/pi/varta-uploader`, Verwaltung über `http://192.168.4.15:8788`. Start/Status/Logs: `cd /home/pi/varta-uploader` und `sudo docker compose up -d`, `sudo docker compose ps` bzw. `sudo docker compose logs --tail=50`. Docker und der Collector starten automatisch wieder. Der Laptop-Collector ist nach erfolgreicher Übernahme mit leerem Puffer beendet worden.

Die lokale Collector-Verwaltung bietet oben eine Dropdown-Auswahl für Deutsch und Englisch. Sie übersetzt Einstellungen, Status und bekannte Fehlermeldungen und speichert die Sprachwahl nur im jeweiligen Browser. Ungespeicherte Eingaben bleiben beim Umschalten erhalten.
