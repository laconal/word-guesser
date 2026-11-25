import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCheck,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipForwardFilled,
  IconX,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { api, DIFFICULTY_COLOR, type Word } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { loadSettings } from "../lib/settings";
import { sound } from "../lib/sound";
import Screen from "./Screen";

type Phase = "loading" | "ready" | "playing" | "paused" | "results" | "empty" | "error";
type Status = "guessed" | "skipped";

interface Entry {
  word: Word;
  status: Status;
  /** `timeout` — word timer ran out; `roundEnd` — the word on screen when the round ended. */
  reason?: "timeout" | "roundEnd";
}

interface RoundSummary {
  guessed: number;
  skipped: number;
  score: number;
}

const BATCH = 300;
const REFILL_BELOW = 30;
const TICK_MS = 100;

function summarize(entries: Entry[], penalty: boolean): RoundSummary {
  const guessed = entries.filter((e) => e.status === "guessed").length;
  // The word left on screen at round end isn't a real skip: show it, but don't count or penalize it.
  const skipped = entries.filter((e) => e.status === "skipped" && e.reason !== "roundEnd").length;
  return { guessed, skipped, score: guessed - (penalty ? skipped : 0) };
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s);
};

export default function Game() {
  const navigate = useNavigate();
  const { t, errorText } = useI18n();
  // Settings are frozen for the whole game.
  const [settings] = useState(loadSettings);
  const roundMs = settings.roundTime * 1000;
  const wordMs = settings.wordTime * 1000;
  const wordLimited = settings.wordTime > 0;

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [history, setHistory] = useState<RoundSummary[]>([]);
  const [current, setCurrent] = useState<Word | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [roundLeft, setRoundLeft] = useState(roundMs);
  const [wordLeft, setWordLeft] = useState(wordMs);
  const [quitOpen, setQuitOpen] = useState(false);

  // Mutable game clock / word supply, read inside the interval without re-subscribing.
  const queue = useRef<Word[]>([]);
  const used = useRef<number[]>([]);
  const refilling = useRef<Promise<void> | null>(null);
  const roundLeftRef = useRef(roundMs);
  const wordLeftRef = useRef(wordMs);
  const currentRef = useRef<Word | null>(null);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;

  const fetchBatch = useCallback(
    (exclude: number[]) =>
      api.drawWords({
        lang: settings.lang,
        categoryIds: settings.categoryIds,
        difficulties: settings.difficulties,
        exclude,
        limit: BATCH,
      }),
    [settings],
  );

  /** Tops up the queue; once every word was shown, starts over (allowing repeats). */
  const refill = useCallback(() => {
    refilling.current ??= (async () => {
      try {
        const queued = queue.current.map((w) => w.id);
        let batch = await fetchBatch([...used.current, ...queued]);
        if (batch.length === 0 && queue.current.length === 0) {
          used.current = currentRef.current ? [currentRef.current.id] : [];
          batch = await fetchBatch(used.current);
          if (batch.length === 0) batch = await fetchBatch([]);
        }
        queue.current.push(...batch);
      } finally {
        refilling.current = null;
      }
    })();
    return refilling.current;
  }, [fetchBatch]);

  const showNext = useCallback(async () => {
    if (queue.current.length < REFILL_BELOW) {
      const pending = refill();
      if (queue.current.length === 0) await pending.catch(() => {});
    }
    const next = queue.current.shift() ?? null;
    if (next) used.current.push(next.id);
    currentRef.current = next;
    setCurrent(next);
    wordLeftRef.current = wordMs;
    setWordLeft(wordMs);
  }, [refill, wordMs]);

  // Initial load.
  useEffect(() => {
    refill()
      .then(() => setPhase(queue.current.length ? "ready" : "empty"))
      .catch((e) => {
        setError(errorText(e));
        setPhase("error");
      });
  }, [refill]);

  const resolve = useCallback(
    (status: Status, reason?: Entry["reason"]) => {
      const word = currentRef.current;
      if (!word || phaseRef.current !== "playing") return;
      currentRef.current = null; // guards against double taps until the next word arrives
      setEntries((prev) => [...prev, { word, status, reason }]);
      if (status === "guessed") sound.guessed();
      else if (reason === "timeout") sound.timeout();
      else sound.skipped();
      void showNext();
    },
    [showNext],
  );

  const endRound = useCallback(() => {
    const word = currentRef.current;
    currentRef.current = null;
    if (word) setEntries((prev) => [...prev, { word, status: "skipped", reason: "roundEnd" }]);
    setCurrent(null);
    setRoundLeft(0);
    setPhase("results");
    sound.roundEnd();
  }, []);

  // Game clock: delta-based, so pausing and background throttling don't drift.
  useEffect(() => {
    if (phase !== "playing") return;
    let last = performance.now();
    let lastSecond = Math.ceil(roundLeftRef.current / 1000);
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;

      roundLeftRef.current -= dt;
      if (roundLeftRef.current <= 0) {
        endRound();
        return;
      }
      const sec = Math.ceil(roundLeftRef.current / 1000);
      if (sec !== lastSecond) {
        lastSecond = sec;
        if (sec <= 3) sound.tick();
      }
      setRoundLeft(roundLeftRef.current);

      if (wordLimited && currentRef.current) {
        wordLeftRef.current -= dt;
        if (wordLeftRef.current <= 0) resolve("skipped", "timeout");
        else setWordLeft(wordLeftRef.current);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [phase, wordLimited, endRound, resolve]);

  // Pause when the app goes to background.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && phaseRef.current === "playing") setPhase("paused");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Keep the screen on while a round is running (where supported).
  useEffect(() => {
    if (phase !== "playing") return;
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [phase]);

  const startRound = async () => {
    sound.unlock();
    setEntries([]);
    roundLeftRef.current = roundMs;
    setRoundLeft(roundMs);
    await showNext();
    setPhase("playing");
  };

  const toggleEntry = (i: number) =>
    setEntries((prev) =>
      prev.map((e, j) => (j === i ? { ...e, status: e.status === "guessed" ? "skipped" : "guessed" } : e)),
    );

  const commitRound = () => {
    setHistory((h) => [...h, summarize(entries, settings.skipPenalty)]);
    setEntries([]);
  };

  const nextRound = () => {
    commitRound();
    setRound((r) => r + 1);
    setPhase("ready");
  };

  const finishGame = () => {
    commitRound();
    navigate("/setup", { replace: true });
  };

  // ------------------------------------------------------------------ render

  if (phase === "loading") {
    return (
      <Screen back="/setup" title={t.common.loading}>
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      </Screen>
    );
  }

  if (phase === "error" || phase === "empty") {
    return (
      <Screen back="/setup" title={t.game.title}>
        <Alert color={phase === "error" ? "red" : "yellow"} title={t.game.cantStart}>
          {phase === "error" ? error : t.game.noWords}
        </Alert>
        <Button mt="md" onClick={() => navigate("/setup")}>
          {t.game.toSetup}
        </Button>
      </Screen>
    );
  }

  if (phase === "ready") {
    const totals = history.reduce(
      (t, r) => ({ guessed: t.guessed + r.guessed, skipped: t.skipped + r.skipped, score: t.score + r.score }),
      { guessed: 0, skipped: 0, score: 0 },
    );
    return (
      <Screen
        back="/setup"
        title={t.game.title}
        footer={
          <Button size="xl" fullWidth leftSection={<IconPlayerPlayFilled />} onClick={startRound}>
            {t.game.startRound}
          </Button>
        }
      >
        <Stack align="center" gap="xs" mt="xl">
          <Text c="dimmed">{t.game.passPhone}</Text>
          <Title order={1} fz={48}>
            {t.game.round(round)}
          </Title>
          <Group gap={6}>
            <Badge variant="light">{t.langs[settings.lang]}</Badge>
            <Badge variant="light">{t.game.roundBadge(fmt(roundMs))}</Badge>
            <Badge variant="light">{wordLimited ? t.game.wordBadge(settings.wordTime) : t.game.wordUnlimited}</Badge>
            {settings.skipPenalty && (
              <Badge variant="light" color="red">
                {t.game.penaltyBadge}
              </Badge>
            )}
          </Group>
        </Stack>

        {history.length > 0 && (
          <Paper withBorder p="sm" mt="xl">
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.game.colRound}</Table.Th>
                  <Table.Th ta="right">{t.game.guessed}</Table.Th>
                  <Table.Th ta="right">{t.game.skipped}</Table.Th>
                  <Table.Th ta="right">{t.game.score}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{i + 1}</Table.Td>
                    <Table.Td ta="right">{r.guessed}</Table.Td>
                    <Table.Td ta="right">{r.skipped}</Table.Td>
                    <Table.Td ta="right">{r.score}</Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr fw={700}>
                  <Table.Td>{t.game.total}</Table.Td>
                  <Table.Td ta="right">{totals.guessed}</Table.Td>
                  <Table.Td ta="right">{totals.skipped}</Table.Td>
                  <Table.Td ta="right">{totals.score}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Screen>
    );
  }

  if (phase === "results") {
    const s = summarize(entries, settings.skipPenalty);
    return (
      <Screen
        title={t.game.roundOver(round)}
        footer={
          <Group grow>
            <Button size="lg" variant="default" onClick={finishGame}>
              {t.game.finish}
            </Button>
            <Button size="lg" onClick={nextRound}>
              {t.game.nextRound}
            </Button>
          </Group>
        }
      >
        <SimpleGrid cols={3} spacing="xs">
          <Stat label={t.game.guessed} value={s.guessed} color="teal" />
          <Stat label={t.game.skipped} value={s.skipped} color="red" />
          <Stat label={t.game.score} value={s.score} color="violet" />
        </SimpleGrid>

        {entries.length > 0 ? (
          <>
            <Text size="xs" c="dimmed" mt="md" mb={6}>
              {t.game.tapToFix}
            </Text>
            <Stack gap={6}>
              {entries.map((e, i) => (
                <UnstyledButton key={i} onClick={() => toggleEntry(i)}>
                  <Paper withBorder px="md" py="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600} td={e.status === "skipped" ? "line-through" : undefined} c={e.status === "skipped" ? "dimmed" : undefined}>
                          {e.word.text}
                        </Text>
                        {e.reason && (
                          <Text size="xs" c="dimmed">
                            {e.reason === "timeout" ? t.game.reasonTimeout : t.game.reasonRoundEnd}
                          </Text>
                        )}
                      </div>
                      {e.status === "guessed" ? (
                        <ActionIcon component="span" color="teal" variant="filled" radius="xl" aria-label={t.game.guessed}>
                          <IconCheck size={18} />
                        </ActionIcon>
                      ) : (
                        <ActionIcon component="span" color="red" variant="light" radius="xl" aria-label={t.game.skipped}>
                          <IconX size={18} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Paper>
                </UnstyledButton>
              ))}
            </Stack>
          </>
        ) : (
          <Text c="dimmed" ta="center" mt="xl">
            {t.game.emptyRound}
          </Text>
        )}
      </Screen>
    );
  }

  // playing / paused
  const s = summarize(entries, settings.skipPenalty);
  const paused = phase === "paused";
  const lowRound = roundLeft <= 5000;

  return (
    <div className="screen no-select">
      <header className="screen-header" style={{ justifyContent: "space-between" }}>
        <ActionIcon
          variant="light"
          size="xl"
          radius="xl"
          aria-label={paused ? t.game.resume : t.game.pause}
          onClick={() => setPhase(paused ? "playing" : "paused")}
        >
          {paused ? <IconPlayerPlayFilled /> : <IconPlayerPauseFilled />}
        </ActionIcon>
        <Text className={`big-timer ${lowRound ? "timer-danger" : ""}`} fz={40}>
          {fmt(roundLeft)}
        </Text>
        <Group gap={6}>
          <Badge size="lg" color="teal" variant="light" leftSection={<IconCheck size={14} />}>
            {s.guessed}
          </Badge>
          <Badge size="lg" color="red" variant="light" leftSection={<IconX size={14} />}>
            {s.skipped}
          </Badge>
        </Group>
      </header>

      <Progress value={(roundLeft / roundMs) * 100} size="xs" radius={0} color={lowRound ? "red" : "violet"} />

      <div className="word-card">
        {paused ? (
          <Stack align="center">
            <Title order={2}>{t.game.pause}</Title>
            <Button size="lg" leftSection={<IconPlayerPlayFilled />} onClick={() => setPhase("playing")}>
              {t.game.resume}
            </Button>
            <Button variant="subtle" color="red" onClick={() => setQuitOpen(true)}>
              {t.game.endRound}
            </Button>
          </Stack>
        ) : current ? (
          <Stack align="center" gap="md">
            <Badge color={DIFFICULTY_COLOR[current.difficulty]} variant="light">
              {t.difficulty[current.difficulty]}
            </Badge>
            <div key={current.id} className="word-text">
              {current.text}
            </div>
          </Stack>
        ) : (
          <Loader />
        )}
      </div>

      {wordLimited && !paused && (
        <Stack gap={4} px="md" pb="sm">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {t.game.wordTime}
            </Text>
            <Text size="sm" fw={700} className={`big-timer ${wordLeft <= 3000 ? "timer-danger" : ""}`}>
              {fmt(wordLeft)} {t.game.seconds}
            </Text>
          </Group>
          <Progress
            value={(wordLeft / wordMs) * 100}
            size="lg"
            color={wordLeft <= 3000 ? "red" : "teal"}
            transitionDuration={TICK_MS}
          />
        </Stack>
      )}

      <SimpleGrid cols={2} spacing="sm" p="md" pt={4} className="game-buttons">
        <Button
          color="red"
          variant="light"
          disabled={paused || !current}
          leftSection={<IconPlayerSkipForwardFilled />}
          onClick={() => resolve("skipped")}
        >
          {t.game.skip}
        </Button>
        <Button color="teal" disabled={paused || !current} leftSection={<IconCheck />} onClick={() => resolve("guessed")}>
          {t.game.accept}
        </Button>
      </SimpleGrid>

      <Modal opened={quitOpen} onClose={() => setQuitOpen(false)} title={t.game.endRoundTitle} centered>
        <Text size="sm">{t.game.endRoundText}</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setQuitOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            color="red"
            onClick={() => {
              setQuitOpen(false);
              endRound();
            }}
          >
            {t.game.endRoundConfirm}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Paper withBorder p="sm" ta="center">
      <Text fz={36} fw={800} c={color} className="big-timer">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Paper>
  );
}
