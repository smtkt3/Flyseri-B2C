# Airline identity directory

`airlines.json` and `public/airlines/` were assembled on 2026-09-26 from:

- [Airlines Logos Dataset](https://github.com/imgmongelli/airlines-logos-dataset), MIT-licensed metadata and PNG assets. Only unambiguous two-character IATA codes were imported.
- [Soaring Symbols](https://github.com/soaring-symbols/soaring-symbols), MIT-licensed metadata and curated SVG icons. These take precedence when a code occurs in both directories.
- [Hahnair Systems](https://www.hahnair.com/en/carrier/H1) for its H1 name and logo.
- [Batik Air Malaysia](https://en.wikipedia.org/wiki/Batik_Air_Malaysia) for the OD name and current shared Batik Air logo.

Airline logos remain trademarks of their respective owners. The directory is for identifying carriers in shopping results, not proof of endorsement. Airline names and code assignments can change. Known airlines without a logo retain their name and use a code badge. Unknown or ambiguous codes are shown as codes without an invented airline name or logo. The Sabre response remains authoritative for marketing and operating carrier codes.

To refresh, download the two source repositories and run `scripts/update-airline-directory.ps1` with paths to their JSON files and asset folders. Supply the H1 and OD logo files separately.
