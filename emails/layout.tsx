import * as React from "react";
import {
  Body,
  Container,
  Font,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

export const SITE_URL = "https://egeuysal.com";

const tailwindConfig = {
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
    },
  },
};

type EmailFrameProps = {
  preview: string;
  children: React.ReactNode;
  unsubscribeUrl?: string;
};

export function EmailFrame({ preview, children, unsubscribeUrl }: EmailFrameProps) {
  return (
    <Html lang="en" className="bg-[#050505]">
      <Head>
        <Font
          fontFamily="Geist Mono"
          fallbackFontFamily="monospace"
          webFont={{
            url: `${SITE_URL}/fonts/GeistMono-Variable.woff2`,
            format: "woff2",
          }}
          fontWeight={400}
        />
        <meta name="color-scheme" content="dark" />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind config={tailwindConfig}>
        <Body className="m-0 w-full bg-[#050505] font-mono text-[#f5f5f5]">
          <Container className="mx-auto w-full max-w-[620px] px-6 py-10">
            <Section className="border-b border-solid border-[#262626] pb-6">
              <Link
                href={SITE_URL}
                className="font-mono text-[15px] leading-5 text-[#f5f5f5] no-underline"
              >
                Ege Uysal
              </Link>
              <Text className="m-0 mt-1 font-mono text-[11px] uppercase leading-4 tracking-[0.16em] text-[#737373]">
                Blog
              </Text>
            </Section>

            {children}

            <Hr className="my-8 border-0 border-t border-solid border-[#262626]" />
            <Section>
              <Text className="m-0 font-mono text-[11px] leading-5 text-[#737373]">
                <Link href={SITE_URL} className="text-[#a3a3a3] underline decoration-[#404040] underline-offset-4">
                  egeuysal.com
                </Link>
                {unsubscribeUrl ? (
                  <>
                    {" · "}
                    <Link
                      href={unsubscribeUrl}
                      className="text-[#a3a3a3] underline decoration-[#404040] underline-offset-4"
                    >
                      Unsubscribe
                    </Link>
                  </>
                ) : null}
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
