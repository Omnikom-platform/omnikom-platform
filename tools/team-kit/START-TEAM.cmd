@echo off
rem START-TEAM: double-click to open the ELEV8 audit team as fresh Claude sessions, one terminal tab each:
rem   ELEV8 Lead (the main session), ELEV8 Researcher, ELEV8 SEO analyst. The Reviewer is started by the Lead after the report only.
rem Each tab runs tools\team\boot.mjs, which loads that role's boot prompt (icm\agents\boot-prompts.md).
rem Sign in to the Claude account you want first (claude /login in any terminal), then double-click this file.
rem   START-TEAM.cmd --dry   shows the three commands without starting anything.
cd /d "%~dp0"
if /i "%~1"=="--dry" (
  for %%r in (lead researcher seo-analyst) do node tools\team\boot.mjs %%r --dry
  exit /b 0
)
where claude >nul 2>nul || (echo Claude Code is not installed or not on PATH. & pause & exit /b 1)
where wt >nul 2>nul
if %errorlevel%==0 (
  wt -w ELEV8 new-tab --title "ELEV8 Lead" -d "%~dp0." cmd /k node tools\team\boot.mjs lead ; new-tab --title "ELEV8 Researcher" -d "%~dp0." cmd /k node tools\team\boot.mjs researcher ; new-tab --title "ELEV8 SEO analyst" -d "%~dp0." cmd /k node tools\team\boot.mjs seo-analyst ; focus-tab -t 0
) else (
  start "ELEV8 Lead" /D "%~dp0." cmd /k node tools\team\boot.mjs lead
  start "ELEV8 Researcher" /D "%~dp0." cmd /k node tools\team\boot.mjs researcher
  start "ELEV8 SEO analyst" /D "%~dp0." cmd /k node tools\team\boot.mjs seo-analyst
)
