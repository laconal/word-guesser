import { useCallback, useEffect, useState } from "react";
import { ActionIcon, Alert, Button, Group, Loader, Menu, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconChevronRight, IconDotsVertical, IconDownload, IconFileImport, IconPlus } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { api, type CustomList } from "../lib/api";
import { useI18n } from "../lib/i18n";
import ListForm from "./ListForm";
import Screen from "./Screen";
import { ExportModal, ImportModal } from "./TransferModals";

export default function Lists() {
  const navigate = useNavigate();
  const { t, errorText } = useI18n();
  const [lists, setLists] = useState<CustomList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);

  const reload = useCallback(() => {
    api
      .listCustomLists()
      .then(setLists)
      .catch((e) => setError(errorText(e)));
  }, [errorText]);

  useEffect(reload, [reload]);

  return (
    <Screen
      title={t.lists.title}
      back="/"
      actions={
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" size="lg" aria-label={t.common.actions}>
              <IconDotsVertical />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconFileImport size={16} />} onClick={() => setTransfer("import")}>
              {t.transfer.importAll}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconDownload size={16} />}
              disabled={!lists?.length}
              onClick={() => setTransfer("export")}
            >
              {t.transfer.exportAll}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      }
      footer={
        <Button size="lg" fullWidth leftSection={<IconPlus />} onClick={() => setCreateOpen(true)}>
          {t.lists.newList}
        </Button>
      }
    >
      {error && <Alert color="red">{error}</Alert>}
      {!lists ? (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      ) : lists.length === 0 ? (
        <Stack align="center" mt={60} gap="xs" px="lg">
          <Text fz={48}>📝</Text>
          <Text fw={600}>{t.lists.emptyTitle}</Text>
          <Text c="dimmed" ta="center" size="sm">
            {t.lists.emptyText}
          </Text>
        </Stack>
      ) : (
        <Stack gap="sm">
          {lists.map((l) => (
            <UnstyledButton key={l.id} onClick={() => navigate(`/lists/${l.id}`)}>
              <Paper withBorder p="md">
                <Group wrap="nowrap">
                  <Text fz={28}>{l.icon || "📝"}</Text>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} truncate>
                      {l.name}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {t.words(l.entries)} · RU {l.ruCount} · EN {l.enCount}
                    </Text>
                  </div>
                  <IconChevronRight size={18} opacity={0.5} />
                </Group>
              </Paper>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      <ImportModal
        opened={transfer === "import"}
        onClose={() => setTransfer(null)}
        onImported={reload}
        listId={null}
      />
      <ExportModal opened={transfer === "export"} onClose={() => setTransfer(null)} listId={null} />

      <ListForm
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={async ({ name, icon }) => {
          const created = await api.createCustomList(name, icon);
          navigate(`/lists/${created.id}`);
        }}
      />
    </Screen>
  );
}
