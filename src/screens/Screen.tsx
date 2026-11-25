import type { ReactNode } from "react";
import { ActionIcon, Title } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";

interface Props {
  title?: ReactNode;
  /** Path to go back to; `true` = history back; omitted = no back button. */
  back?: string | true;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}

export default function Screen({ title, back, actions, footer, children, bodyClassName }: Props) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <div className="screen">
      {(title || back || actions) && (
        <header className="screen-header">
          {back && (
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label={t.common.back}
              onClick={() => (back === true ? navigate(-1) : navigate(back))}
            >
              <IconArrowLeft />
            </ActionIcon>
          )}
          <Title order={3} style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
            {title}
          </Title>
          {actions}
        </header>
      )}
      <main className={`screen-body ${bodyClassName ?? ""}`}>{children}</main>
      {footer && <footer className="screen-footer">{footer}</footer>}
    </div>
  );
}
