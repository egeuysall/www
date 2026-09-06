import * as React from "react";
import { Heading, Link, Section, Text } from "react-email";

import { EmailFrame, SITE_URL } from "./layout";

export type NewsletterEmailProps = {
  title: string;
  description: string;
  publishedAt: string;
  url: string;
  unsubscribeUrl: string;
};

const preview: NewsletterEmailProps = {
  title: "The End of the Chatbot Era",
  description:
    "From Turing and Dartmouth to GPT-6 Astra, AI has moved from predicting language to operating inside real workflows. I felt that shift while rebuilding Paper and Igloo in about an hour.",
  publishedAt: "September 5, 2026",
  url: `${SITE_URL}/blog/the-end-of-the-chatbot-era/`,
  unsubscribeUrl: `${SITE_URL}/newsletter/`,
};

export function NewsletterEmail(props: Partial<NewsletterEmailProps> = {}) {
  const values = { ...preview, ...props };

  return (
    <EmailFrame preview={`${values.title} · ${values.publishedAt}`} unsubscribeUrl={values.unsubscribeUrl}>
      <Section className="pt-8">
        <Heading as="h1" className="m-0 font-mono text-[16px] font-semibold leading-6 text-[#f5f5f5]">
          {values.title}
        </Heading>
        <Text className="m-0 mt-2 font-mono text-[12px] leading-5 text-[#a3a3a3]">
          {values.publishedAt}
        </Text>
        <Text className="m-0 mt-7 font-mono text-[14px] leading-[1.65] text-[#d4d4d4]">
          {values.description}
        </Text>
        <Text className="m-0 mt-7 font-mono text-[13px] leading-6">
          <Link
            href={values.url}
            className="font-mono text-[#f5f5f5] underline decoration-[#525252] underline-offset-4"
          >
            Read “{values.title}” →
          </Link>
        </Text>
      </Section>
    </EmailFrame>
  );
}

export default NewsletterEmail;
