import { SegmentedControl, Stack, Title } from "@mantine/core";
import { useI18n, type UiLang } from "../lib/i18n";
import Screen from "./Screen";

// Language names are shown in their own language, as is conventional for language pickers.
const UI_LANGS: { value: UiLang; label: string }[] = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  return (
    <Screen title={t.settings.title} back="/">
      <Stack gap={6}>
        <Title order={5}>{t.settings.uiLang}</Title>
        <SegmentedControl fullWidth data={UI_LANGS} value={lang} onChange={(v) => setLang(v as UiLang)} />
      </Stack>
    </Screen>
  );
}
