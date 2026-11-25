# Объясни!

Party-игра на объяснение слов: ведущий видит слово и объясняет его, не называя, остальные угадывают.

**Стек:** Tauri 2 · Rust · SQLite (rusqlite, bundled) · React 19 · Mantine 9 · Vite.
Платформы: Android (APK), Linux (.deb), Windows (.msi / .exe).

## Возможности

- Встроенный словарь: 15 категорий × 3 уровня сложности × RU/EN (~1440 слов).
- Настройка игры: язык, время на слово (по умолчанию 10 с, 0 = без лимита), время раунда (60 с),
  несколько категорий и уровней сложности (ничего не выбрано — все стандартные категории / все уровни),
  опциональный штраф за пропуск.
- Во время раунда: «Засчитать» / «Пропустить», пропуск по истечении времени на слово, пауза
  (и автопауза при сворачивании приложения).
- Итоги раунда: объяснено / пропущено / очки, результат любого слова можно исправить нажатием;
  таблица по раундам за всю игру.
- Свои списки слов: создание, переименование, удаление. Каждое слово — пара «русское + английское»
  (можно заполнить только одно поле) с общим уровнем сложности. Поля проверяются: в русском только
  кириллица, в английском только латиница; между частями — пробел или дефис (в английском ещё апостроф).
  Проверка выполняется и в интерфейсе, и в Rust. Свои списки появляются в категориях для того языка слов,
  на котором в них есть слова, и в «случайный набор» не подмешиваются.
- Импорт/экспорт своих списков — Excel (.xlsx), JSON, SQL. Все списки сразу («Мои списки» → ⋮)
  или один список (редактор списка → ⋮). См. раздел «Форматы файлов».
- Язык интерфейса (Настройки): русский (по умолчанию) или английский. Название приложения в лаунчере
  следует языку системы.

## Структура

```
src/                     React UI
  lib/api.ts             типизированные обёртки над Tauri-командами
  lib/i18n.tsx           словари интерфейса RU/EN + провайдер языка
  lib/settings.ts        настройки игры (localStorage)
  lib/sound.ts           звуки через Web Audio
  screens/               Home, Settings, Setup, Game, Lists, ListEditor, WordForm
src-tauri/
  src/db.rs              схема SQLite + миграции (PRAGMA user_version), загрузка словаря,
                         запросы, валидация слов (+ unit-тесты)
  src/transfer.rs        импорт/экспорт: xlsx (rust_xlsxwriter + calamine), JSON, SQL (+ тесты)
  src/lib.rs             Tauri-команды; диалоги файлов (plugin-dialog) и запись/чтение (plugin-fs)
  data/words.json        встроенный словарь
  gen/android/           Android-проект (MainActivity с отступами под системные панели, подпись)
scripts/android.sh       обёртка над `tauri android` с нужными JAVA_HOME / ANDROID_HOME / NDK_HOME
```

### Словарь

`src-tauri/data/words.json` вшит в бинарник. При запуске сравнивается хэш файла с сохранённым
в БД: если словарь изменился, встроенные категории перезаливаются, а пользовательские списки
не затрагиваются. Чтобы добавить слова — правьте JSON (уровни: `[лёгкий, средний, сложный]`,
слова через запятую) и пересоберите.

## Форматы файлов

Во всех форматах одни и те же данные: списки (название, иконка) и слова (русское, английское, сложность 1–3).
Формат при импорте определяется по содержимому, а не по расширению: Android отдаёт `content://`-ссылки.

- **Excel** — один лист, колонки: Список · Иконка · Русский · Английский · Сложность. Первая строка —
  заголовок (распознаётся и пропускается). Сложность — 1/2/3 или название уровня на русском/английском;
  пусто = средняя. Читаются все листы.
- **JSON** — `{"app":"obyasni","format":"word-lists","version":1,"lists":[{"name","icon","words":[{"ru","en","difficulty"}]}]}`;
  также принимается просто массив списков.
- **SQL** — обычный SQLite-скрипт с таблицами `lists(id, name, icon)` и `words(list_id, ru, en, difficulty)`,
  его можно открыть в любом SQLite-клиенте. При импорте скрипт выполняется в отдельной in-memory базе,
  где разрешены только CREATE TABLE/INSERT/SELECT/транзакции (без ATTACH, PRAGMA, VACUUM INTO и т.п.)
  и действует лимит времени.

Импорт:
- **все списки**: слова попадают в список с тем же названием (без учёта регистра), иначе создаётся новый;
- **в конкретный список**: все слова файла добавляются в него.

Каждое слово проходит ту же проверку, что и при ручном вводе, а дубликаты пропускаются. Импорт идёт одной
транзакцией и в конце показывает отчёт: сколько добавлено, сколько дубликатов, сколько некорректных
слов (с примерами).

## Сборка

Общее для всех платформ: [Rust](https://rustup.rs) (stable) и Node.js 20+.

```bash
npm install                  # один раз после клонирования
cd src-tauri && cargo test --lib && cd ..   # тесты слоя данных и импорта/экспорта
```

| Платформа | Команда | Где взять результат |
|---|---|---|
| Android APK (arm64) | `npm run android:apk:arm64` | `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` |
| Android APK (все ABI) | `npm run android:apk` | там же |
| Linux .deb | `npm run build:deb` | `src-tauri/target/release/bundle/deb/Obyasni_<версия>_amd64.deb` |
| Windows .msi + .exe | `npm run build:windows` *(на Windows)* | `src-tauri\target\release\bundle\msi\` и `...\bundle\nsis\` |
| Windows .msi | `npm run build:windows:msi` *(на Windows)* | `src-tauri\target\release\bundle\msi\` |
| Windows .exe | `npm run build:windows:exe` *(на Windows)* | `src-tauri\target\release\bundle\nsis\` |
| Windows .exe из Linux | `npm run build:windows:cross` | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` |

Запуск без сборки установщика (десктоп, hot reload): `npm run desktop:dev`.

### Android

Нужны JDK 17/21, Android SDK + NDK и Rust-таргеты:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

`scripts/android.sh` сам находит JDK в `~/.local/jdk*` и последний NDK в `~/Android/Sdk/ndk`;
`ANDROID_HOME`, `NDK_HOME` и `JAVA_HOME` можно переопределить через окружение.

```bash
npm run android:apk:arm64   # APK только для arm64 (быстрее, подходит почти всем телефонам)
npm run android:apk         # универсальный APK (arm64, armv7, x86, x86_64)
npm run android:dev         # запуск на подключённом устройстве/эмуляторе с hot reload
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

#### Подпись

Release-сборка подписывается ключом `keystore/release.jks`; пароли лежат в
`src-tauri/gen/android/keystore.properties`. Оба файла в `.gitignore`. **Сделайте резервную копию** —
без этого ключа нельзя будет выпускать обновления, которые ставятся поверх уже установленного приложения.

### Linux (.deb)

Системные зависимости для сборки (Debian/Ubuntu):

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev \
  build-essential curl wget file libssl-dev libxdo-dev
```

```bash
npm run build:deb
sudo apt install ./src-tauri/target/release/bundle/deb/Obyasni_0.1.0_amd64.deb   # установка
sudo apt remove obyasni                                                          # удаление
```

Пакет `obyasni` ставит бинарник `/usr/bin/allias`, иконки и ярлык в меню приложений
(«Объясни!» при русской локали, иначе «Explain!»; шаблон — `src-tauri/linux/obyasni.desktop`).
Зависимости пакета: `libwebkit2gtk-4.1-0`, `libgtk-3-0`. Данные пользователя хранятся в
`~/.local/share/com.stedysherm.allias/`.

### Windows (.msi и .exe)

Собирается **на Windows 10/11**. Нужны:

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) с компонентом
  «Desktop development with C++»;
- Rust с MSVC-тулчейном (`rustup default stable-msvc`), Node.js 20+;
- WebView2 — в Windows 10/11 уже есть. Если его нет, установщик скачает его сам.

WiX (для .msi) и NSIS (для .exe) Tauri скачивает автоматически при первой сборке.

```powershell
npm install
npm run build:windows       # оба установщика
npm run build:windows:msi   # только MSI
npm run build:windows:exe   # только EXE (NSIS)
```

На выходе:

- `src-tauri\target\release\bundle\msi\Obyasni_0.1.0_x64_ru-RU.msi` и `..._en-US.msi` — MSI на двух
  языках интерфейса установщика;
- `src-tauri\target\release\bundle\nsis\Obyasni_0.1.0_x64-setup.exe` — EXE-установщик с выбором языка
  (русский/английский). Он ставится для текущего пользователя и не требует прав администратора.

`upgradeCode` для MSI зафиксирован в `tauri.conf.json`: не меняйте его, иначе новые версии не будут
обновлять уже установленную. Данные пользователя хранятся в `%APPDATA%\com.stedysherm.allias\`.

#### Кросс-сборка .exe из Linux (экспериментально)

Из Linux можно собрать только NSIS-установщик (.exe), MSI — нельзя. Подготовка (один раз):

```bash
sudo apt install nsis lld llvm clang
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
```

```bash
npm run build:windows:cross
# → src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Obyasni_0.1.0_x64-setup.exe
```

### Версия

Версия задаётся в `src-tauri/tauri.conf.json` (`version`), её же стоит держать в `package.json` и
`src-tauri/Cargo.toml`. Из неё формируются имена установщиков, версия MSI и `versionCode` для Android.

## Иконки

- Иконка приложения — глиф «messages» из [Tabler Icons](https://tabler.io/icons) (MIT,
  `assets/LICENSE-tabler-icons.txt`) на фирменном фоне: `app-icon.svg` → `npx tauri icon app-icon.svg`.
- Иконки интерфейса — `@tabler/icons-react` (MIT).
- Иконки категорий — системные эмодзи.
