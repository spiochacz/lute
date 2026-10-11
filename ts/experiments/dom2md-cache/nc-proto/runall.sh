cd /c/Users/SlawomirPiochacz/projects/lute/ts/experiments/dom2md-cache/nc-proto
run() { for m in wysiwyg ir; do node search.ts /c/Users/SLAWOM~1/AppData/Local/Temp/claude/C--Users-SlawomirPiochacz-projects-lute/48dda619-f5be-46c8-890c-871fcbf3ea45/scratchpad/nc-corpus.json $m "{\"$1\":true}" 100000 200 > /c/Users/SLAWOM~1/AppData/Local/Temp/claude/C--Users-SlawomirPiochacz-projects-lute/48dda619-f5be-46c8-890c-871fcbf3ea45/scratchpad/ncout2/$1.$m.txt 2>&1; done; }
for cfg in "$@"; do run $cfg & done
wait
