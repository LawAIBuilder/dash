export type DocumentTemplateField = {
  name: string;
  label: string;
  default?: string | null;
};

export type UserDocumentTemplate = {
  id: string;
  case_id: string;
  name: string;
  description: string | null;
  body_markdown: string;
  fields: DocumentTemplateField[];
  ai_hints: string | null;
  created_at: string;
  updated_at: string;
};

export type UserDocumentTemplateFill = {
  id: string;
  template_id: string;
  case_id: string;
  values: Record<string, string>;
  rendered_markdown: string;
  source_item_id: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
};
