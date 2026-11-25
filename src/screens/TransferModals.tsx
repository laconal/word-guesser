import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, SegmentedControl, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconDownload, IconFileImport } from "@tabler/icons-react";
import { transferApi, type ExportFormat, type ImportReport } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** `listId: null` = all custom lists. */
interface Scope {
  listId: number | null;
  listName?: string;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "xlsx", label: "Excel" },
  { value: "json", label: "JSON" },
  { value: "sql", label: "SQL" },
];

export function ExportModal({ opened, onClose, listId, listName }: Scope & { opened: boolean; onClose: () => void }) {
  const { t, lang, errorText } = useI18n();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setError(null);
      setSaved(null);
    }
  }, [opened]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const name = await transferApi.exportLists(listId, format, lang);
      if (name) setSaved(name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={listId === null ? t.transfer.exportTitleAll : t.transfer.exportTitleList(listName ?? "")}
    >
      <Stack>
        <div>
          <Text size="sm" fw={500} mb={4}>
            {t.transfer.format}
          </Text>
          <SegmentedControl fullWidth data={FORMATS} value={format} onChange={(v) => setFormat(v as ExportFormat)} />
          <Text size="xs" c="dimmed" mt={6}>
            {t.transfer.formatHints[format]}
          </Text>
        </div>
        {error && <Alert color="red">{error}</Alert>}
        {saved && <Alert color="teal">{t.transfer.saved(saved)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t.transfer.close}
          </Button>
          <Button leftSection={<IconDownload size={18} />} loading={busy} onClick={run}>
            {t.transfer.exportButton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ImportModal({
  opened,
  onClose,
  onImported,
  listId,
  listName,
}: Scope & { opened: boolean; onClose: () => void; onImported: () => void }) {
  const { t, lang, errorText } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    if (opened) {
      setError(null);
      setReport(null);
    }
  }, [opened]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await transferApi.importLists(listId, lang);
      if (res) {
        setReport(res);
        onImported();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const stats: [string, number, string?][] = report
    ? [
        [t.transfer.added, report.added, "teal"],
        ...(listId === null
          ? ([
              [t.transfer.created, report.listsCreated],
              [t.transfer.updated, report.listsUpdated],
            ] as [string, number][])
          : []),
        [t.transfer.duplicates, report.duplicates],
        [t.transfer.invalid, report.invalid, report.invalid ? "red" : undefined],
      ]
    : [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={listId === null ? t.transfer.importTitleAll : t.transfer.importTitleList(listName ?? "")}
    >
      <Stack>
        {!report && (
          <>
            <Text size="sm">{listId === null ? t.transfer.importHintAll : t.transfer.importHintList}</Text>
            <Text size="xs" c="dimmed">
              {t.transfer.importRules}
            </Text>
          </>
        )}
        {error && <Alert color="red">{error}</Alert>}
        {report && (
          <Alert color={report.added ? "teal" : "yellow"} title={t.transfer.done}>
            <SimpleGrid cols={2} spacing={4} verticalSpacing={2}>
              {stats.map(([label, value, color]) => (
                <Group key={label} justify="space-between" wrap="nowrap" style={{ gridColumn: "span 2" }}>
                  <Text size="sm">{label}</Text>
                  <Text size="sm" fw={700} c={color}>
                    {value}
                  </Text>
                </Group>
              ))}
            </SimpleGrid>
            {report.invalidSamples.length > 0 && (
              <Text size="xs" c="dimmed" mt={6}>
                {t.transfer.examples(report.invalidSamples.map((s) => `«${s}»`).join(", "))}
              </Text>
            )}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t.transfer.close}
          </Button>
          <Button leftSection={<IconFileImport size={18} />} loading={busy} onClick={run}>
            {t.transfer.pickFile}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
