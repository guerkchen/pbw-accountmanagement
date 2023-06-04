## Einrichtung der Berechtigung bei Microsoft ##
- Im Microsoft Azure Portal unter "Verwalten" auf "App-Registrierung"
- App "Stammesmanager-to-M365" auswählen
  - Oder neue App anlegen
    - Appname ist egal
    - Unterstützte Kontotypen "Nur Konten in diesem Organisationsverzeichnis (nur "Pfadfinderbund Weltenbummler" – einzelner Mandant)"
    - kein Redirect URL
- In der App auf "Zertifikate & Geheimnisse"
- Neuen Geheimen Clientschlüssel mit beliebiger Laufzeit anlegen
- In der .env eintragen
- TenantId = MandantenID, bekommt man z.B. aus der App-"Übersicht"

Quelle: https://learn.microsoft.com/en-us/graph/sdks/choose-authentication-providers?tabs=CS  
Auch sehr gut für weitere Arbeiten: https://dzone.com/articles/getting-access-token-for-microsoft-graph-using-oau


