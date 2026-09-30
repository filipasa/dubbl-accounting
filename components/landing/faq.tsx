import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/shared/container";
import { SectionHeader } from "@/components/shared/section-header";

const faqs = [
  {
    question: "Is fixbooks really free?",
    answer:
      "Yes. fixbooks is licensed under the Apache 2.0 license. You can use it as Cloud Hosted with no feature limitations, no user caps, and no hidden costs.",
  },
  {
    question: "Is fixbooks Cloud Hosted?",
    answer:
      "Absolutely. fixbooks is available Cloud Hosted. We provide secure cloud hosting, automated backups, and comprehensive deployment guides for AWS, GCP, and bare metal.",
  },
  {
    question: "Does fixbooks support multi-currency?",
    answer:
      "Yes. fixbooks supports transactions in any currency with automatic exchange rate conversion. Realized and unrealized gain/loss tracking is built in.",
  },
  {
    question: "How does double-entry bookkeeping work in fixbooks?",
    answer:
      "Every transaction must have balanced debits and credits. This is enforced at the database level, meaning it's impossible to create an unbalanced entry. fixbooks supports multi-leg journal entries for complex transactions.",
  },
  {
    question: "Can I migrate from QuickBooks or Xero?",
    answer:
      "Yes. fixbooks supports CSV import with built-in column mapping for QuickBooks, Xero, FreshBooks, and Wave. You can import accounts, contacts, invoices, bills, journal entries, products, and bank transactions from any CSV file.",
  },
  {
    question: "Is there an API?",
    answer:
      "fixbooks is API-first. Every feature available in the UI is also accessible via our REST API with comprehensive OpenAPI documentation. fixbooks also supports the Model Context Protocol (MCP), allowing AI assistants to interact with your business data directly.",
  },
  {
    question: "How do I contribute to fixbooks?",
    answer:
      "We welcome contributions! Check out our GitHub repository for contributing guidelines, open issues labeled 'good first issue', and our development setup guide.",
  },
  {
    question: "Is fixbooks suitable for enterprise use?",
    answer:
      "Yes. fixbooks includes features like audit trails, role-based access control, SSO/SAML support, and multi-tenant architecture. Beyond accounting, fixbooks covers inventory management, project management, payroll, and CRM. Many companies use fixbooks in production as their core business platform.",
  },
  {
    question: "What is MCP support?",
    answer:
      "MCP (Model Context Protocol) is an open standard that lets AI assistants interact with external tools and data. fixbooks ships with 15 built-in MCP tool modules covering contacts, invoices, inventory, projects, and more. This means AI agents like Claude can read, create, and manage your business data directly through a structured protocol.",
  },
];

export function FAQ() {
  return (
    <section className="py-16 md:py-20">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          {/* Left column */}
          <div>
            <SectionHeader
              badge="FAQs"
              title="Frequently asked questions"
              align="left"
              className="mb-6"
            />
            <p className="text-sm text-muted-foreground">
              Can&apos;t find what you&apos;re looking for?{" "}
              <a
                href="mailto:info@fixbooks.io"
                className="text-emerald-600 underline underline-offset-4 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                contact us
              </a>
              .
            </p>
          </div>

          {/* Right column */}
          <div>
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((faq, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
                  className="border-b border-border"
                >
                  <AccordionTrigger className="py-5 text-left text-base font-medium text-foreground hover:no-underline md:text-lg">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </Container>
    </section>
  );
}
