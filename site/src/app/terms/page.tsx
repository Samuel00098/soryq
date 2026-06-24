import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { site } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: `The terms that govern your use of ${site.name}.`,
  alternates: { canonical: '/terms' },
};

const updated = 'June 14, 2026';
// NOTE: Starting point tailored to how Soryq actually works — review with counsel
// and fill in your operating entity + governing jurisdiction before launch.

export default function TermsPage() {
  return (
    <>
      <Nav />

      <main className="legal">
        <header className="legal-head container">
          <span className="eyebrow">Legal</span>
          <h1 className="section-title">Terms of Use</h1>
          <p className="updated">Last updated {updated}</p>
        </header>

        <article className="prose glass container">
          <p>
            These Terms of Use (&quot;Terms&quot;) govern your access to and use of the {site.name}{' '}
            desktop application and the {site.name} website (together, the &quot;Service&quot;). By
            downloading, installing, or using {site.name}, you agree to these Terms. If you do not
            agree, do not use the Service.
          </p>

          <h2>1. License</h2>
          <p>
            {site.name} is proprietary software. Subject to these Terms, you are granted a limited,
            non-exclusive, non-transferable, revocable license to install and use {site.name} on
            devices you own or control for your personal or internal business purposes. You may not
            copy, distribute, resell, sublicense, rent, reverse-engineer, decompile, or attempt to
            derive the source code of the Service, except to the extent that such restriction is
            prohibited by applicable law.
          </p>

          <h2>2. Your responsibilities</h2>
          <ul>
            <li>
              You are responsible for the code, commands, and content you run, edit, or generate with{' '}
              {site.name}.
            </li>
            <li>
              You must keep any API keys, credentials, and license keys you use with {site.name}{' '}
              secure, and comply with the terms of any third-party services you connect (for example,
              your AI provider).
            </li>
            <li>You may not use {site.name} for any unlawful purpose or in violation of these Terms.</li>
          </ul>

          <h2>3. Third-party services</h2>
          <p>
            {site.name} can connect to third-party services you choose to configure — including AI
            providers such as OpenAI, Anthropic, Google, Groq, OpenRouter, or local runtimes like
            Ollama and LM Studio. Your use of those services is governed by their own terms and
            privacy policies. {site.name} sends your requests directly from your machine to the
            provider you configure; we are not responsible for third-party services, their
            availability, or their output.
          </p>

          <h2>4. AI-generated output</h2>
          <p>
            Features that use AI may produce inaccurate or unexpected results. You are responsible for
            reviewing and testing any code or content before relying on it. {site.name} is a tool to
            assist you, not a substitute for your own judgement.
          </p>

          <h2>5. Updates</h2>
          <p>
            {site.name} may check for and install signed updates to keep the application secure and
            current. By using the Service you consent to receiving these updates. We may add, change,
            or remove features over time.
          </p>

          <h2>6. Disclaimers</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties
            of any kind, whether express or implied, including merchantability, fitness for a
            particular purpose, and non-infringement, to the maximum extent permitted by law.
          </p>

          <h2>7. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, {site.name} and its operators will not be liable
            for any indirect, incidental, special, consequential, or punitive damages, or any loss of
            data, profits, or revenue, arising out of or related to your use of the Service.
          </p>

          <h2>8. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. When we do, we will revise the &quot;Last
            updated&quot; date above. Your continued use of the Service after changes take effect
            constitutes acceptance of the revised Terms.
          </p>

          <h2>9. Contact</h2>
          <p>
            Questions about these Terms? Email us at{' '}
            <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
          </p>
        </article>
      </main>

      <Footer />
    </>
  );
}
