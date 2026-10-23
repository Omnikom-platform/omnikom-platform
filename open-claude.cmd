@echo off
rem Opens a normal, top-level Claude Code session in this repo (transcripts on).
rem Clears the variables a parent Claude session leaves behind, which would otherwise make this a child session.
set CLAUDECODE=
set CLAUDE_CODE_BRIDGE_SESSION_ID=
set CLAUDE_CODE_CHILD_SESSION=
set CLAUDE_CODE_ENABLE_CFC=
set CLAUDE_CODE_ENTRYPOINT=
set CLAUDE_CODE_EXECPATH=
set CLAUDE_CODE_MESSAGING_SOCKET=
set CLAUDE_CODE_MESSAGING_TOKEN=
set CLAUDE_CODE_SESSION_ATTENDED=
set CLAUDE_CODE_SESSION_ID=
set CLAUDE_EFFORT=
set CLAUDE_PID=
cd /d "%~dp0"
title Omnikom Platform
claude
