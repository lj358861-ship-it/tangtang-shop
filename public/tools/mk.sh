# usage: mk.sh <file>  (reads page body from stdin; replaces @@HEAD@@)
python3 -c "import sys;h=open('/home/claude/tangtang/tools/head.txt').read().strip();open(sys.argv[1],'w').write(sys.stdin.read().replace('@@HEAD@@',h))" "$1"
