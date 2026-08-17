// Contrato de las plantillas server-side de landing. El HTML lo hornea el server con el
// tracking y el compliance adentro: el usuario solo completa campos, nunca toca HTML.
export interface TplField {
  key: string;
  label: string;
  type: "text" | "textarea" | "color";
  max: number;
  required?: boolean;
  placeholder?: string;
  default: string;
}

export interface TplCtx {
  pixelId: string;
  userSlug: string;
  goBase: string;
  line?: string;
  values: Record<string, string>;
}

export interface TplDef {
  id: string;
  name: string;
  desc: string;
  category: "casino";
  fields: TplField[];
  render(ctx: TplCtx): string;
}
