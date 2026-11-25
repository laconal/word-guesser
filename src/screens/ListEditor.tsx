import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconDotsVertical,
  IconDownload,
  IconFileImport,
  IconPencil,
  IconPlayerPlayFilled,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  DIFFICULTY_COLOR,
  DIFFICULTY_LEVELS,
  type CustomList,
  type Difficulty,
  type Entry,
  type EntryInput,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { loadSettings, saveSettings } from "../lib/settings";
import ListForm from "./ListForm";
import Screen from "./Screen";
import { ExportModal, ImportModal } from "./TransferModals";
import WordForm from "./WordForm";

export default function ListEditor() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();
  const { t, errorText } = useI18n();

  const [list, setList] = useState<CustomList | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Entry | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);

  const reload = useCallback(async () => {
    try {
      const [l, e] = await Promise.all([api.getCustomList(id), api.listEntries(id)]);
      setList(l);
      setEntries(e);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id, errorText]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Mutations reject with error codes; WordForm maps them onto its fields.
  const add = async (input: EntryInput) => {
    await api.addEntry(id, input);
    await reload();
  };

  const save = async (input: EntryInput) => {
    if (!editing) return;
    await api.updateEntry(id, editing.id, input);
    setEditing(null);
    await reload();
  };

  const run = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch (e) {
      setError(errorText(e));
    }
    await reload();
  };

  const cycleDifficulty = (e: Entry) => {
    const next = ((e.difficulty % 3) + 1) as Difficulty;
    setEntries((all) => all?.map((x) => (x.id === e.id ? { ...x, difficulty: next } : x)) ?? null);
    void run(() => api.updateEntry(id, e.id, { ru: e.ru, en: e.en, difficulty: next }));
  };

  const remove = (e: Entry) => {
    setEditing(null);
    setEntries((all) => all?.filter((x) => x.id !== e.id) ?? null);
    void run(() => api.deleteEntry(id, e.id));
  };

  const playThisList = () => {
    if (!list) return;
    const current = loadSettings();
    // Keep the chosen word language if the list has words in it; otherwise switch.
    const has = { ru: list.ruCount > 0, en: list.enCount > 0 };
    const lang = has[current.lang] ? current.lang : has.ru ? "ru" : "en";
    saveSettings({ ...current, lang, categoryIds: [list.id], difficulties: [] });
    navigate("/setup");
  };

  if (!list || !entries) {
    return (
      <Screen back="/lists" title={t.lists.title}>
        {error ? <Alert color="red">{error}</Alert> : <Loader />}
      </Screen>
    );
  }

  return (
    <Screen
      back="/lists"
      title={
        <>
          {list.icon} {list.name}
        </>
      }
      actions={
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" size="lg" aria-label={t.common.actions}>
              <IconDotsVertical />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setRenameOpen(true)}>
              {t.editor.rename}
            </Menu.Item>
            <Menu.Item leftSection={<IconFileImport size={16} />} onClick={() => setTransfer("import")}>
              {t.transfer.importToList}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconDownload size={16} />}
              disabled={entries.length === 0}
              onClick={() => setTransfer("export")}
            >
              {t.transfer.exportList}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setDeleteOpen(true)}>
              {t.editor.deleteList}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          leftSection={<IconPlayerPlayFilled />}
          disabled={entries.length === 0}
          onClick={playThisList}
        >
          {t.editor.play}
        </Button>
      }
    >
      <Stack gap="md">
        <Group gap={6}>
          <Badge variant="default">{t.words(list.entries)}</Badge>
          <Badge variant="light">RU {list.ruCount}</Badge>
          <Badge variant="light">EN {list.enCount}</Badge>
        </Group>

        <Paper withBorder p="sm">
          <WordForm submitLabel={t.editor.add} submitIcon={<IconPlus size={18} />} onSubmit={add} resetOnSuccess />
        </Paper>

        {error && (
          <Alert color="red" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {entries.length === 0 ? (
          <Text c="dimmed" ta="center" mt="md">
            {t.editor.empty}
          </Text>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              {t.editor.tapHint}
            </Text>
            {DIFFICULTY_LEVELS.map((d) => {
              const group = entries.filter((e) => e.difficulty === d);
              if (!group.length) return null;
              return (
                <Stack key={d} gap={6}>
                  <Title order={6} c="dimmed">
                    {t.difficulty[d]} · {group.length}
                  </Title>
                  {group.map((e) => (
                    <Paper key={e.id} withBorder px="sm" py={6}>
                      <Group wrap="nowrap" gap="xs">
                        <UnstyledButton style={{ flex: 1, minWidth: 0 }} onClick={() => setEditing(e)}>
                          <Text truncate c={e.ru ? undefined : "dimmed"}>
                            <Text span size="xs" c="dimmed" mr={6}>
                              RU
                            </Text>
                            {e.ru ?? "—"}
                          </Text>
                          <Text truncate c={e.en ? undefined : "dimmed"}>
                            <Text span size="xs" c="dimmed" mr={6}>
                              EN
                            </Text>
                            {e.en ?? "—"}
                          </Text>
                        </UnstyledButton>
                        <Badge
                          component="button"
                          color={DIFFICULTY_COLOR[e.difficulty]}
                          variant="light"
                          style={{ cursor: "pointer", border: 0 }}
                          onClick={() => cycleDifficulty(e)}
                          aria-label={t.editor.changeDifficulty}
                        >
                          {t.difficulty[e.difficulty]}
                        </Badge>
                        <ActionIcon variant="subtle" color="red" aria-label={t.common.delete} onClick={() => remove(e)}>
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              );
            })}
          </>
        )}
      </Stack>

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={t.editor.editWord} centered>
        {editing && (
          <WordForm
            key={editing.id}
            initial={editing}
            submitLabel={t.common.save}
            onSubmit={save}
            extraActions={
              <Button variant="subtle" color="red" onClick={() => remove(editing)}>
                {t.common.delete}
              </Button>
            }
          />
        )}
      </Modal>

      <ImportModal
        opened={transfer === "import"}
        onClose={() => setTransfer(null)}
        onImported={() => void reload()}
        listId={id}
        listName={list.name}
      />
      <ExportModal
        opened={transfer === "export"}
        onClose={() => setTransfer(null)}
        listId={id}
        listName={list.name}
      />

      <ListForm
        opened={renameOpen}
        onClose={() => setRenameOpen(false)}
        initial={{ name: list.name, icon: list.icon }}
        onSubmit={async ({ name, icon }) => setList(await api.updateCustomList(id, name, icon))}
      />

      <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)} title={t.editor.deleteTitle} centered>
        <Text size="sm">{t.editor.deleteText(list.name, list.entries)}</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setDeleteOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            color="red"
            onClick={async () => {
              try {
                await api.deleteCustomList(id);
                navigate("/lists", { replace: true });
              } catch (e) {
                setError(errorText(e));
                setDeleteOpen(false);
              }
            }}
          >
            {t.common.delete}
          </Button>
        </Group>
      </Modal>
    </Screen>
  );
}
