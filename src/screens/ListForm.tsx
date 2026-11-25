import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useI18n } from "../lib/i18n";

const ICONS = ["📝", "🎉", "🎬", "🎮", "🎵", "🍔", "✈️", "🏫", "💼", "❤️", "🐶", "⭐", "🔥", "🧠", "🌈", "🎲"];

interface Values {
  name: string;
  icon: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onSubmit: (v: Values) => Promise<void>;
  /** Present when editing an existing list. */
  initial?: Values;
}

export default function ListForm({ opened, onClose, onSubmit, initial }: Props) {
  const { t, errorText } = useI18n();
  const [values, setValues] = useState<Values>(initial ?? { name: "", icon: ICONS[0] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (opened) {
      setValues(initial ?? { name: "", icon: ICONS[0] });
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const submit = async () => {
    if (!values.name.trim()) {
      setError(t.errors.name_required);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={initial ? t.lists.editTitle : t.lists.newTitle} centered>
      <Stack>
        <TextInput
          label={t.lists.name}
          placeholder={t.lists.namePlaceholder}
          maxLength={60}
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.currentTarget.value })}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          data-autofocus
        />
        <div>
          <Text size="sm" fw={500} mb={4}>
            {t.lists.icon}
          </Text>
          <Group gap={6}>
            {ICONS.map((icon) => (
              <UnstyledButton
                key={icon}
                onClick={() => setValues({ ...values, icon })}
                fz={24}
                w={42}
                h={42}
                ta="center"
                style={{
                  borderRadius: 8,
                  border: `2px solid ${values.icon === icon ? "var(--mantine-primary-color-filled)" : "transparent"}`,
                }}
              >
                {icon}
              </UnstyledButton>
            ))}
          </Group>
        </div>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button loading={busy} onClick={submit}>
            {initial ? t.common.save : t.common.create}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
