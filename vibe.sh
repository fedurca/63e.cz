#!/bin/bash
set -e

# 1. Kontrola, zda existuje index.html
if [ ! -f "index.html" ]; then
    echo "❌ Chyba: index.html nenalezen v aktuální složce!"
    exit 1
fi

# 2. Extrakce obsahu tagu <title>
RAW_TITLE=$(sed -n 's/.*<title[^>]*>\(.*\)<\/title>.*/\1/p' index.html | head -n 1)

# 3. Očištění názvu pro bezpečné použití
SAFE_TITLE=$(echo "$RAW_TITLE" \
    | tr ' ' '_' \
    | tr -cd 'A-Za-z0-9._-' \
    | sed 's/^_*//;s/_*$//')

if [ -z "$SAFE_TITLE" ]; then
    SAFE_TITLE="hra_zaloha"
fi

# 4. Získání aktuálního času
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# 5. Název výsledného archivu
ARCHIVE_NAME="${TIMESTAMP}_${SAFE_TITLE}.tar"

echo "📦 Vytvářím archiv herních souborů: $ARCHIVE_NAME"

# 6. Dočasný seznam souborů
TMP_LIST=$(mktemp)

# 7. Najdi relevantní soubory hry
find . \
    \( \
        -path "./.git" -o \
        -path "./node_modules" -o \
        -path "./vendor" -o \
        -path "./tmp" -o \
        -path "./temp" -o \
        -path "./cache" -o \
        -path "./.cache" \
    \) -prune -o \
    -type f \
    \( \
        -iname "*.html" -o \
        -iname "*.htm" -o \
        -iname "*.js" -o \
        -iname "*.mjs" -o \
        -iname "*.cjs" -o \
        -iname "*.css" -o \
        -iname "*.json" -o \
        -iname "*.webmanifest" -o \
        -iname "*.wasm" -o \
        -iname "*.map" -o \
        -iname "*.png" -o \
        -iname "*.jpg" -o \
        -iname "*.jpeg" -o \
        -iname "*.gif" -o \
        -iname "*.webp" -o \
        -iname "*.svg" -o \
        -iname "*.ico" -o \
        -iname "*.mp3" -o \
        -iname "*.wav" -o \
        -iname "*.ogg" -o \
        -iname "*.m4a" -o \
        -iname "*.mp4" -o \
        -iname "*.webm" -o \
        -iname "*.ttf" -o \
        -iname "*.otf" -o \
        -iname "*.woff" -o \
        -iname "*.woff2" -o \
        -iname "*.txt" -o \
        -iname "*.md" \
    \) \
    ! -iname "$ARCHIVE_NAME" \
    ! -iname "*.tar" \
    ! -iname "*.tar.gz" \
    ! -iname "*.tgz" \
    ! -iname "*.zip" \
    ! -iname "*.rar" \
    ! -iname "*.7z" \
    ! -iname "*.log" \
    ! -iname ".DS_Store" \
    -print | sort > "$TMP_LIST"

# 8. Kontrola, že máme co balit
if [ ! -s "$TMP_LIST" ]; then
    echo "❌ Chyba: Nebyly nalezeny žádné relevantní herní soubory."
    rm -f "$TMP_LIST"
    exit 1
fi

echo "📄 Soubory zahrnuté do archivu:"
cat "$TMP_LIST"

# 9. Vytvoření archivu
tar -cvf "$ARCHIVE_NAME" -T "$TMP_LIST"

# 10. Úklid
rm -f "$TMP_LIST"

echo "✅ Hotovo! Soubory jsou zabaleny v: $ARCHIVE_NAME"