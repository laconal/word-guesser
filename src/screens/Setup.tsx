import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { IconPlayerPlayFilled } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import {
  api,
  DIFFICULTY_COLOR,
  DIFFICULTY_LEVELS,
  WORD_LANGS,
  type Category,
  type Difficulty,
  type Lang,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { sound } from "../lib/sound";
import Screen from "./Screen";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Stack gap={6}>
      <div>
        <Title order={5}>{title}</Title>
        {hint && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </div>
      {children}
    </Stack>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const { t, lang: uiLang, errorText } = useI18n();
  const [settings, update] = useSettings();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCategories(null);
    api
      .listCategories(settings.lang)
      .then((cats) => {
        if (!alive) return;
        setCategories(cats);
        // Drop selections that don't exist in this language (e.g. a custom list without words in it).
        const known = new Set(cats.map((c) => c.id));
        if (settings.categoryIds.some((id) => !known.has(id))) {
          update({ categoryIds: settings.categoryIds.filter((id) => known.has(id)) });
        }
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.lang]);

  const builtin = categories?.filter((c) => !c.isCustom) ?? [];
  const custom = categories?.filter((c) => c.isCustom) ?? [];

  const pool = useMemo(
    () =>
      settings.categoryIds.length
        ? (categories ?? []).filter((c) => settings.categoryIds.includes(c.id))
        : (categories ?? []).filter((c) => !c.isCustom),
    [categories, settings.categoryIds],
  );
  const perLevel = (d: Difficulty) => pool.reduce((s, c) => s + c.counts[d - 1], 0);
  const available = (settings.difficulties.length ? settings.difficulties : DIFFICULTY_LEVELS).reduce(
    (s, d) => s + perLevel(d),
    0,
  );

  const start = () => {
    sound.unlock();
    navigate("/game");
  };

  const categoryChips = (list: Category[]) => (
    <SimpleGrid cols={2} spacing={8}>
      {list.map((c) => (
        <Chip key={c.id} value={String(c.id)} variant="light" className="category-chip">
          <span style={{ marginRight: 6 }}>{c.icon}</span>
          {uiLang === "en" ? c.nameEn : c.nameRu}
        </Chip>
      ))}
    </SimpleGrid>
  );

  return (
    <Screen
      title={t.setup.title}
      back="/"
      footer={
        <Stack gap={8}>
          <Text size="sm" c={available ? "dimmed" : "red"} ta="center">
            {available ? t.setup.available(available) : t.setup.noWords}
          </Text>
          <Button size="lg" fullWidth leftSection={<IconPlayerPlayFilled />} disabled={!available} onClick={start}>
            {t.setup.start}
          </Button>
        </Stack>
      }
    >
      <Stack gap="lg">
        {error && <Alert color="red">{error}</Alert>}

        <Section title={t.setup.wordsLang}>
          <SegmentedControl
            fullWidth
            value={settings.lang}
            onChange={(v) => update({ lang: v as Lang })}
            data={WORD_LANGS.map((l) => ({ value: l, label: t.langs[l] }))}
          />
        </Section>

        <Section title={t.setup.time}>
          <Group grow align="flex-start">
            <SecondsInput
              label={t.setup.perWord}
              description={t.setup.perWordHint}
              min={0}
              max={300}
              value={settings.wordTime}
              onCommit={(wordTime) => update({ wordTime })}
            />
            <SecondsInput
              label={t.setup.round}
              description={t.setup.roundHint}
              min={10}
              max={900}
              step={10}
              value={settings.roundTime}
              onCommit={(roundTime) => update({ roundTime })}
            />
          </Group>
          <Switch
            mt={4}
            label={t.setup.penalty}
            checked={settings.skipPenalty}
            onChange={(e) => update({ skipPenalty: e.currentTarget.checked })}
          />
        </Section>

        <Section title={t.setup.difficulty} hint={t.setup.difficultyHint}>
          <Chip.Group
            multiple
            value={settings.difficulties.map(String)}
            onChange={(v) => update({ difficulties: v.map(Number).sort() as Difficulty[] })}
          >
            <Group gap={8}>
              {DIFFICULTY_LEVELS.map((d) => (
                <Chip key={d} value={String(d)} color={DIFFICULTY_COLOR[d]} variant="light">
                  {t.difficulty[d]} · {perLevel(d)}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Section>

        <Section title={t.setup.categories} hint={t.setup.categoriesHint}>
          {!categories ? (
            <Loader size="sm" />
          ) : (
            <Chip.Group
              multiple
              value={settings.categoryIds.map(String)}
              onChange={(v) => update({ categoryIds: v.map(Number) })}
            >
              <Stack gap="sm">
                {categoryChips(builtin)}
                {custom.length > 0 && (
                  <>
                    <Text size="sm" fw={600} mt={4}>
                      {t.setup.myLists}
                    </Text>
                    {categoryChips(custom)}
                  </>
                )}
              </Stack>
            </Chip.Group>
          )}
          {settings.categoryIds.length > 0 && (
            <Button
              variant="subtle"
              size="xs"
              onClick={() => update({ categoryIds: [] })}
              style={{ alignSelf: "start" }}
            >
              {t.setup.reset(settings.categoryIds.length)}
            </Button>
          )}
        </Section>
      </Stack>
    </Screen>
  );
}

/** Number field that lets the user clear/retype freely and only commits in-range integers. */
function SecondsInput(props: {
  label: string;
  description: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onCommit: (v: number) => void;
}) {
  const { value, min, max, onCommit, ...rest } = props;
  const [draft, setDraft] = useState<number | string>(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <NumberInput
      {...rest}
      min={min}
      max={max}
      inputMode="numeric"
      allowDecimal={false}
      allowNegative={false}
      value={draft}
      onChange={(v) => {
        setDraft(v);
        if (typeof v === "number" && v >= min && v <= max) onCommit(v);
      }}
      onBlur={() => setDraft(value)}
    />
  );
}
