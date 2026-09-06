import * as React from "react";
import { Heading, Link, Section, Text } from "react-email";

import { EmailFrame, SITE_URL } from "./layout";

export type ConfirmationEmailProps = {
  confirmationUrl: string;
};

const preview: ConfirmationEmailProps = {
  confirmationUrl: `${SITE_URL}/newsletter/`,
};

export function ConfirmationEmail(props: Partial<ConfirmationEmailProps> = {}) {
  const values = { ...preview, ...props };

  return (
    <EmailFrame preview="Confirm your subscription">
      <Section className="pt-8">
        <Heading as="h1" className="m-0 font-mono text-[16px] font-semibold leading-6 text-[#f5f5f5]">
          Confirm your subscription
        </Heading>
        <Text className="m-0 mt-7 font-mono text-[14px] leading-[1.65] text-[#d4d4d4]">
          Click the link below to confirm your subscription to Ege Uysal&apos;s blog.
        </Text>
        <Text className="m-0 mt-7 font-mono text-[13px] leading-6">
          <Link
            href={values.confirmationUrl}
            className="inline-block rounded-sm border border-solid border-[#404040] px-3 py-2 font-mono text-[12px] leading-4 text-[#f5f5f5] no-underline"
          >
            Confirm subscription
          </Link>
        </Text>
      </Section>
    </EmailFrame>
  );
}

export default ConfirmationEmail;
