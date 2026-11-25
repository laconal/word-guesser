import { useState } from "react";
import { Button, List, Modal, Stack, Text, Title } from "@mantine/core";
import { IconBook2, IconInfoCircle, IconPlayerPlayFilled, IconSettings } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import Screen from "./Screen";

export default function Home() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <Screen>
      <Stack h="100%" justify="center" align="stretch" gap="xl" px="md">
        <Stack align="center" gap={4}>
          <img src="/icon.svg" width={112} height={112} alt="" style={{ borderRadius: 24 }} />
          <Title order={1} fz={44} mt="md">
            {t.appName}
          </Title>
          <Text c="dimmed" ta="center">
            {t.tagline}
          </Text>
        </Stack>

        <Stack gap="sm">
          <Button size="xl" leftSection={<IconPlayerPlayFilled />} onClick={() => navigate("/setup")}>
            {t.home.play}
          </Button>
          <Button size="lg" variant="light" leftSection={<IconBook2 />} onClick={() => navigate("/lists")}>
            {t.home.myLists}
          </Button>
          <Button size="lg" variant="light" leftSection={<IconSettings />} onClick={() => navigate("/settings")}>
            {t.home.settings}
          </Button>
          <Button size="lg" variant="subtle" leftSection={<IconInfoCircle />} onClick={() => setRulesOpen(true)}>
            {t.home.howToPlay}
          </Button>
        </Stack>
      </Stack>

      <Modal opened={rulesOpen} onClose={() => setRulesOpen(false)} title={t.home.howToPlay} centered>
        <List spacing="xs">
          {t.home.rules.map((rule) => (
            <List.Item key={rule}>{rule}</List.Item>
          ))}
        </List>
      </Modal>
    </Screen>
  );
}
