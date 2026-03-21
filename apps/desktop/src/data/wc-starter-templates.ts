export type StarterTemplateKey =
  | "blank"
  | "demand_letter"
  | "lien_notice"
  | "qme_request"
  | "intervention_notice"
  | "claim_petition_cover"
  | "claim_petition_body"
  | "affidavit_of_service"
  | "discovery_response_shell";

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
  },
  {
    key: "claim_petition_cover",
    name: "Claim petition — cover letter (MN)",
    description: "Cover letter to OAH / WCCA with standard workers' compensation matter identification.",
    body_markdown: `# FILING SUBMISSION

**To:** Workers' Compensation Court of Appeals / Office of Administrative Hearings  
**Re:** {{matter_name}} — {{employee_name}} v. {{employer_name}}  
**Date:** {{letter_date}}

Please find enclosed:

- Claim Petition and supporting exhibits  
- {{enclosed_list}}

Respectfully submitted,

{{sender_name}}  
{{sender_title}}  
{{firm_name}}
`,
    ai_hints: "Minnesota WC, WCCA, OAH, cover letter, filing"
  },
  {
    key: "claim_petition_body",
    name: "Claim petition — body (MN outline)",
    description: "Statutory-framed petition outline with placeholders for injury, employment, and benefits.",
    body_markdown: `# CLAIM PETITION

**Employee:** {{employee_name}}  
**Employer:** {{employer_name}}  
**Insurer:** {{insurer_name}}  
**Date of injury:** {{doi}}  
**Matter / docket:** {{matter_name}}

## Jurisdiction and parties

{{jurisdiction_paragraph}}

## Injury and medical causation

{{injury_causation}}

## Benefits sought

{{benefits_sought}}

## Factual basis

{{factual_basis}}

Under penalties of perjury, the undersigned certifies that the foregoing is true and correct to the best of their knowledge.

{{signature_block}}
`,
    ai_hints: "Minnesota workers compensation, Minn. Stat. ch. 176, petition, OAH"
  },
  {
    key: "affidavit_of_service",
    name: "Affidavit of service (outline)",
    description: "Service method, date, and recipient identification for filed materials.",
    body_markdown: `# AFFIDAVIT OF SERVICE

I, {{affiant_name}}, state:

1. I am over 18 and not a party to this matter.
2. On {{service_date}}, I served the documents listed below by {{service_method}} on {{recipient_description}}.
3. True copies were served.

**Documents served:** {{documents_list}}

**Service address / details:** {{service_details}}

Declared under penalty of perjury under Minnesota law.

{{signature_block}}  
{{date_signed}}
`,
    ai_hints: "service of process, Minnesota, WC filing"
  },
  {
    key: "discovery_response_shell",
    name: "Discovery responses — shell",
    description: "Numbered responses with objection line and document references.",
    body_markdown: `# RESPONSES TO {{discovery_title}}

**Matter:** {{matter_name}}  
**Responding party:** {{employee_name}}

---

## INTERROGATORY NO. {{n}}

**Response:** {{response_text}}

**Objections:** {{objections_or_none}}

**Supporting documents:** {{doc_refs}}

---

Attorney verification or declaration as required.

{{signature_block}}
`,
    ai_hints: "interrogatories, discovery, objections, Minnesota WC"
  }
];

export function getStarterTemplate(key: StarterTemplateKey): WcStarterTemplate {
  return WC_STARTER_TEMPLATES.find((t) => t.key === key) ?? WC_STARTER_TEMPLATES[0]!;
}
