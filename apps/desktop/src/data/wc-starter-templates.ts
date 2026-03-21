export type StarterTemplateKey = "blank" | "demand_letter" | "lien_notice" | "qme_request" | "intervention_notice";

export type WcStarterTemplate = {
  key: StarterTemplateKey;
  name: string;
  description: string;
  body_markdown: string;
  ai_hints: string;
};

export const WC_STARTER_TEMPLATES: WcStarterTemplate[] = [
  {
    key: "blank",
    name: "Blank",
    description: "Minimal starter with one placeholder for the matter title.",
    body_markdown: `# {{matter_name}}

`,
    ai_hints: "generic letter, custom"
  },
  {
    key: "demand_letter",
    name: "Demand letter (outline)",
    description: "Structured demand with common WC placeholders.",
    body_markdown: `# DEMAND FOR BENEFITS

**Matter:** {{matter_name}}  
**Employee:** {{employee_name}}  
**Employer:** {{employer_name}}  
**Insurer:** {{insurer_name}}  

## Summary

{{demand_summary}}

## Relief requested

{{relief_requested}}

Respectfully,

{{sender_name}}  
{{sender_title}}
`,
    ai_hints: "demand letter, benefits, 4060"
  },
  {
    key: "lien_notice",
    name: "Notice of lien (outline)",
    description: "Carrier and matter identification for lien correspondence.",
    body_markdown: `# NOTICE OF LIEN

**To:** {{insurer_name}}  
**Re:** {{matter_name}} — {{employee_name}}

{{lien_body}}

Date: {{letter_date}}
`,
    ai_hints: "lien, carrier notice, EDD, Medicare"
  },
  {
    key: "qme_request",
    name: "QME / med-legal request",
    description: "Request for evaluation or records with standard fields.",
    body_markdown: `# REQUEST FOR MEDICAL-LEGAL EVALUATION

**Applicant:** {{employee_name}}  
**Employer:** {{employer_name}}  
**Claim / matter:** {{matter_name}}

{{qme_request_body}}

Hearing date (if any): {{hearing_date}}
`,
    ai_hints: "QME, panel, med-legal, evaluation"
  },
  {
    key: "intervention_notice",
    name: "Intervention / joinder (outline)",
    description: "Notice to parties re intervention or related proceedings.",
    body_markdown: `# NOTICE

**To:** {{recipient_name}}  
**Re:** {{matter_name}} — {{employee_name}} v. {{employer_name}}

{{intervention_body}}

Dated: {{letter_date}}
`,
    ai_hints: "intervention, joinder, WCAB, lien claimant"
  }
];

export function getStarterTemplate(key: StarterTemplateKey): WcStarterTemplate {
  return WC_STARTER_TEMPLATES.find((t) => t.key === key) ?? WC_STARTER_TEMPLATES[0]!;
}
