export type PickedElement = {
  element: string;
  elementPath: string;
  fullPath: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  cssClasses: string[];
  computedStyles: Record<string, string>;
  nearbyText: string;
  selectedText?: string;
  reactComponents?: string[];
  sourceFile?: string;
};

export type SelectionAttachment = {
  text: string;
  elementPath: string;
};

export type PageContext = {
  title: string;
  url: string;
  host: string;
};

export type WorkingFile = {
  url: string;
  name: string;
  content: string;
};
