# herdr-revive-windows

[dmazlum/herdr-revive](https://github.com/dmazlum/herdr-revive) 0.8.0을 Windows + PowerShell용으로 고친 포크다.
무엇을 왜 바꿨는지는 [README.windows.md](README.windows.md)에 있고, upstream과의 차이는 `git diff`로 본다.

## 수정한 뒤 적용하기

hook(`~\.claude\settings.json`, `~\.codex\hooks.json`)과 PowerShell `$PROFILE` 블록은 이 저장소가 아니라
**설치된 사본** `$HOME\.config\herdr-app\mods\revive\revive.mjs`를 실행한다. 저장소만 고치면 아무 일도 일어나지 않는다.

```powershell
Copy-Item -Recurse -Force .\mods\revive\* "$HOME\.config\herdr-app\mods\revive\"
herdr-app check "$HOME\.config\herdr-app\mods\revive"
```

- symlink를 쓰지 않는다. Herdr는 symlink로 연결한 mod가 바뀌어도 다시 읽지 않는다.
- hook 명령이나 profile 블록(`psShellBlock`) 자체를 바꿨다면 `node "$HOME\.config\herdr-app\mods\revive\revive.mjs" install`을 다시 실행한다.
- 설치 상태 확인: `revive.mjs doctor`. 제거: `revive.mjs uninstall`(원본은 `.revive-backup`).

## 테스트

- `npm test`만 돌린다(`test/windows.test.js`).
- **`npm run test:posix`(upstream 테스트)는 Windows에서 절대 돌리지 않는다.** upstream 테스트는 `HOME`만 임시 폴더로
  바꾸는데, Windows의 Node `homedir()`은 `USERPROFILE`을 쓴다. 그래서 실제 `~\.claude\settings.json`,
  `~\.codex\hooks.json`에 hook을 쓰고, `~\.zshrc`와 `~\.bash_profile`을 만든다(실제로 그렇게 됐다).
- install을 시험할 때는 `USERPROFILE`, `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`를 모두 임시 폴더로
  바꾸고 `--no-shell`을 붙인다. `$PROFILE` 경로는 PowerShell이 레지스트리에서 찾기 때문에 환경 변수로 막을 수 없다.

## 실제 터미널로 시험할 때

- 재시작으로 터미널을 잃는 상황은 분리된 core로 재현한다. 기존 core의 `hc server restart`는 이 세션을 포함한 모든 터미널에 영향을 준다.
  ```sh
  export HC_SESSION=revtest; unset HC_TERMINAL_ID HC_SCOPE HC_TERMINAL_SOCKET
  hc server start
  hc run --bg --keep --name rt --cwd 'C:\work\proj'   # 그 안에서 claude 실행
  # hc server status 의 holder pid를 taskkill /F → 새 PowerShell이 profile 블록으로 resume
  hc server stop
  ```
  죽이기 전에 holder의 명령줄에 `revtest`가 들어 있는지 확인한다.
- Git Bash에서 시험할 때 주의할 점:
  - `MSYS_NO_PATHCONV=1`을 둔다. 없으면 `hc send t /exit`의 `/exit`이 `C:/Program Files/Git/exit`로 바뀌어 Claude에게 메시지로 간다.
  - 백슬래시가 든 JSON이나 경로를 `echo`나 `node -e` 인자로 넘기지 말고, node 안에서 `path.join`으로 만들어 파일로 넘긴다.
  - 터미널 안에서 `hc send`를 쓰면 note(`<hc from=…>`)로 전달되므로 `env -u HC_TERMINAL_ID`로 실행한다.

## Windows에서 알아둘 동작

- herdr-core는 에이전트가 실행 중이어도 terminal의 `foreground`를 shell(powershell.exe)로 보고한다.
  그래서 에이전트는 shell의 자식 프로세스에서 찾는다(`agentProc`).
- `$PROFILE`에 `claude.exe --dangerously-skip-permissions @args`를 실행하는 `claude` 함수를 두는 경우가 있다.
  그래서 switch flag는 한 번만 기록한다(`carriedFlags`). 그렇지 않으면 resume할 때마다 flag가 늘어난다.
