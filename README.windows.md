# Revive for Windows (PowerShell)

[herdr-revive](https://github.com/dmazlum/herdr-revive) 0.8.0을 Windows + PowerShell에서 동작하도록 고친 포크입니다.
재부팅이나 herdr-core 재시작으로 터미널이 새 PowerShell로 돌아왔을 때, 그 터미널에서 돌던 에이전트 세션을
같은 폴더·같은 flag로 다시 실행합니다. 기능 설명은 [README.md](README.md)와 같습니다.

## upstream과 다른 점

| 부분 | upstream (macOS/Linux) | 이 포크 (Windows) |
| --- | --- | --- |
| 자동 resume 위치 | `~/.zshrc`, `~/.bash_profile` | PowerShell `$PROFILE` (powershell.exe, pwsh.exe 둘 다) |
| resume 명령 | POSIX sh (`cd -- … && claude …`) | PowerShell (`Set-Location -LiteralPath … ; & claude …`) |
| 프로세스 표 | `ps -A -o pid,ppid,lstart,args` | `Get-CimInstance Win32_Process` (시작 시각은 UTC ISO) |
| 실행 중인 에이전트 감지 | herdr의 `foreground` | 터미널 shell의 자식 프로세스 (Windows의 herdr는 에이전트가 돌아도 foreground를 shell로 보고함) |
| hook 명령 | `node '/path/revive.mjs' hook` | `node "D:/path/revive.mjs" hook` (cmd, PowerShell, Git Bash 어디서 돌아도 같게 읽힘) |
| 실행 파일 이름 | `claude` | `claude.exe`, `codex.cmd` 같은 Windows 경로와 확장자도 인식 |
| 단축키 | `cmd-shift-r` | `alt-shift-r` (`ctrl-shift-r`은 Herdr의 recap이 사용) |
| 폴더 검사 | 내 소유이고 남이 쓸 수 없는 폴더만 | 폴더인지만 봄 (Windows의 Node는 모든 폴더를 0666, uid 0으로 보고함) |
| 새 버전 알림 | 하루 한 번 GitHub release 확인 | 꺼 둠 (알림의 프롬프트가 upstream을 이 포크 위에 설치하게 만듦) |

profile 블록은 ASCII만 씁니다. 기존 profile의 인코딩(UTF-8 BOM, UTF-16, CP949)과 바이트는 그대로 둡니다.

## 설치

Herdr 안의 PowerShell 터미널에서:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # Windows PowerShell 5.1이 $PROFILE을 읽게 함
git clone https://github.com/Bluewind8791/herdr-revive-windows
cd herdr-revive-windows
Copy-Item -Recurse -Force .\mods\revive "$HOME\.config\herdr-app\mods\"
herdr-app check "$HOME\.config\herdr-app\mods\revive"
node "$HOME\.config\herdr-app\mods\revive\revive.mjs" install
```

클라이언트 Windows에서 Windows PowerShell 5.1의 기본 실행 정책은 `Restricted`입니다. 이 정책에서는 `$PROFILE`이
로드되지 않고(「이 시스템에서 스크립트를 실행할 수 없으므로 … profile.ps1 파일을 로드할 수 없습니다」), 자동 resume도 일어나지 않습니다.
`AllSigned`도 서명 없는 profile을 로드하지 않습니다. PowerShell 7(pwsh)의 기본값은 `RemoteSigned`라 해당하지 않습니다.
`install`과 `doctor`는 블록이 든 profile을 로드하지 못하는 PowerShell이 있으면 경고하고, `doctor`의 `executionPolicy`에 각 정책을 보여 줍니다.
`install`은 실행 정책을 바꾸지 않습니다.

`install`은 다음 파일을 고칩니다. 처음 고칠 때 원본을 `<파일>.revive-backup`으로 복사합니다.

- `~\.claude\settings.json`: `SessionStart`, `SessionEnd` hook (Claude Code가 있을 때)
- `~\.codex\hooks.json`: 같은 hook (Codex가 있을 때)
- PowerShell `$PROFILE`: `# >>> herdr-revive >>>` 블록

그다음 [keys.json](keys.json)의 `"alt-shift-r": "mod.open:revive"`를 `~\.config\herdr-app\keys.json`의 `global`에 합칩니다.
이미 실행 중인 Claude Code 세션은 hook이 없을 때 시작됐으므로 기록되지 않습니다. `node "$HOME\.config\herdr-app\mods\revive\revive.mjs" adopt`로 기록할 수 있습니다(`--dry-run`은 무엇을 기록할지만 보여 줌).

```powershell
node "$HOME\.config\herdr-app\mods\revive\revive.mjs" doctor      # 설치 상태
node "$HOME\.config\herdr-app\mods\revive\revive.mjs" uninstall   # 전부 제거
$env:REVIVE_DEBUG = 1; powershell                                  # 왜 resume했는지/안 했는지 출력
```

`install --powershell` 또는 `install --pwsh`로 profile 하나만 고를 수 있고, `--no-shell`이면 profile은 건드리지 않습니다.

## 동작 방식 (Windows)

1. Claude Code의 `SessionStart` hook이 `revive.mjs hook`을 실행합니다. hook 프로세스에서 부모를 따라 올라가
   `claude.exe`를 거쳐 터미널의 shell에 닿으면, 터미널 label(`hc label`)에 세션 id, 폴더, flag,
   shell pid와 시작 시각을 기록합니다. `/exit`이나 Ctrl+C로 끝내면 `SessionEnd`가 기록을 지웁니다.
2. 재시작 뒤 herdr-core가 새 PowerShell을 띄우면 `$PROFILE`의 블록이 실행됩니다. 이 shell이 터미널의 shell이고,
   기록된 shell(pid + 시작 시각)과 다르면, `revive.mjs check`가 출력한 PowerShell 스크립트로 세션을 resume합니다.
   Herdr는 `powershell.exe -NoExit -Command …`로 터미널을 열기 때문에 profile이 콘솔에서 먼저 실행되고,
   에이전트는 그 자리에서 콘솔을 받습니다.
3. 에이전트가 15초 안에 오류로 끝나면 `failed`로 표시되고, 다음부터는 자동으로 다시 시도하지 않습니다.
   대화창(`alt-shift-r`)의 Resume으로 수동 재시도할 수 있습니다.

## 검증한 것과 안 한 것

이 PC(Windows 11, Herdr app 0.1.13, hc 0.1.18, Windows PowerShell 5.1, Claude Code 2.1.318)에서 확인했습니다.

- `npm test`: Windows 전용 테스트 15개 (명령줄 분해, 경로 인식, PowerShell quoting과 파서 검사, profile 인코딩 보존, 실행 정책 확인)
- 실제 터미널에서 `SessionStart` 기록, `SessionEnd`의 keep(`other`)과 forget(`prompt_input_exit`)
- 테스트 터미널에서 profile 블록 실행: 자동 resume, 같은 shell에서는 반복하지 않음, 실패 표시, 실패 뒤 자동 재시도 안 함,
  대화창 Resume(`revive.mjs resume`)
- 임시 home에서 install, 재설치(변경 없음), uninstall, 백업
- `herdr-app check` 통과

- 설치 뒤 실제 Claude Code로: hook이 세션을 기록함, `/exit`이 기록을 지움
- 분리된 테스트 core(`HC_SESSION=revtest`)에서 holder 프로세스를 죽여 터미널 유실을 재현: 새 PowerShell이 실제 `$PROFILE`의
  블록으로 Claude 세션을 이전 대화 그대로 resume함. 두 번 연속 유실돼도 같은 세션을 다시 resume함
- profile의 `claude` 함수처럼 flag를 직접 붙이는 wrapper가 있어도 switch flag는 한 번만 기록함(resume할 때마다 늘어나지 않음)

아직 확인하지 않은 것:

- 실제 재부팅. holder 유실로 같은 조건을 재현했습니다.
- 대화창의 Fork와 화면 표시, pwsh(PowerShell 7), Codex/Droid/Cursor/pi.

## 테스트

```powershell
npm test            # Windows 테스트 (test/windows.test.js)
```

`npm run test:posix`는 upstream 테스트입니다. **Windows에서 돌리지 마세요.** 이 테스트들은 `HOME`만 임시 폴더로 바꾸는데,
Windows의 Node는 `USERPROFILE`을 home으로 쓰기 때문에 실제 `~\.claude\settings.json` 등을 고칩니다.
