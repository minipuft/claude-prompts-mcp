#!/bin/bash
# Windows environment simulation - no sensitive files
export RUNNER_OS=Windows
export PATH="/c/Windows/System32:/c/Windows:/c/Windows/System32/Wbem:$PATH"
export USERPROFILE=/c/Users/runneradmin
export TEMP=/c/Users/runneradmin/AppData/Local/Temp
export TMP=/c/Users/runneradmin/AppData/Local/Temp
export HOMEDRIVE=C:
export HOMEPATH=/Users/runneradmin
export PATHEXT=.COM:.EXE:.BAT:.CMD:.VBS:.VBE:.JS:.JSE:.WSF:.WSH:.MSC
echo "Windows environment variables set"
