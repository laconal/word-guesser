import { useRef, useState, type ReactNode } from "react";
import { Alert, Button, Group, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import {
  DIFFICULTY_LEVELS,
  hasForeignChars,
  isValidWord,
  normalizeWord,
  type Difficulty,
  type EntryInput,
  type Lang,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

interface Props {
  initial?: EntryInput;
  submitLabel: string;
  submitIcon?: ReactNode;
  /** Rejects with backend error codes (`err.duplicate_ru`, …). */
  onSubmit: (e: EntryInput) => Promise<void>;
  /** Clear the word fields after a successful submit (add mode). */
  resetOnSuccess?: boolean;
  /** Extra buttons shown left of the submit button. */
  extraActions?: ReactNode;
}

type FieldErrors = Partial<Record<Lang | "form", string>>;

/** Russian + English variant of one word, with per-alphabet validation. */
export default function WordForm({ initial, submitLabel, submitIcon, onSubmit, resetOnSuccess, extraActions }: Props) {
  const { t, errorText } = useI18n();
  const [text, setText] = useState<Record<Lang, string>>({ ru: initial?.ru ?? "", en: initial?.en ?? "" });
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 2);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const ruRef = useRef<HTMLInputElement>(null);
  const enRef = useRef<HTMLInputElement>(null);

  const invalidMsg = (lang: Lang) => (lang === "ru" ? t.errors.invalid_ru : t.errors.invalid_en);

  const change = (lang: Lang, value: string) => {
    setText((prev) => ({ ...prev, [lang]: value }));
    // Flag a wrong alphabet immediately; structural issues (stray hyphens) only on submit.
    setErrors((prev) => ({ ...prev, [lang]: hasForeignChars(value, lang) ? invalidMsg(lang) : undefined, form: undefined }));
  };

  const submit = async () => {
    const next: FieldErrors = {};
    for (const lang of ["ru", "en"] as Lang[]) {
      if (!isValidWord(text[lang], lang)) next[lang] = invalidMsg(lang);
    }
    const ru = normalizeWord(text.ru);
    const en = normalizeWord(text.en);
    if (!ru && !en) next.form = t.errors.word_required;
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    try {
      await onSubmit({ ru: ru || null, en: en || null, difficulty });
      if (resetOnSuccess) {
        setText({ ru: "", en: "" });
        ruRef.current?.focus();
      }
    } catch (e) {
      const code = typeof e === "string" ? e : "";
      if (code.endsWith("_ru")) setErrors({ ru: errorText(e) });
      else if (code.endsWith("_en")) setErrors({ en: errorText(e) });
      else setErrors({ form: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const inputProps = {
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    maxLength: 60,
  } as const;

  return (
    <Stack gap="xs">
      <TextInput
        {...inputProps}
        ref={ruRef}
        label={t.editor.ru}
        placeholder={t.editor.ruPlaceholder}
        value={text.ru}
        error={errors.ru}
        onChange={(e) => change("ru", e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && enRef.current?.focus()}
        enterKeyHint="next"
      />
      <TextInput
        {...inputProps}
        ref={enRef}
        label={t.editor.en}
        placeholder={t.editor.enPlaceholder}
        value={text.en}
        error={errors.en}
        onChange={(e) => change("en", e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        enterKeyHint="done"
      />
      <Text size="xs" c="dimmed">
        {t.editor.oneIsEnough}
      </Text>
      <SegmentedControl
        fullWidth
        size="xs"
        value={String(difficulty)}
        onChange={(v) => setDifficulty(Number(v) as Difficulty)}
        data={DIFFICULTY_LEVELS.map((d) => ({ value: String(d), label: t.difficulty[d] }))}
      />
      {errors.form && <Alert color="red" py={6}>{errors.form}</Alert>}
      <Group justify="flex-end" gap="xs">
        {extraActions}
        <Button
          leftSection={submitIcon}
          onClick={submit}
          loading={busy}
          style={extraActions ? undefined : { flex: 1 }}
          disabled={Boolean(errors.ru || errors.en)}
        >
          {submitLabel}
        </Button>
      </Group>
    </Stack>
  );
}
