// Types
export interface HeadingItem {
  depth: number;
  content: string;
  id: string;
  getNode: () => HTMLElement | null;
}

function getHeadingsData(headings: Element[]): HeadingItem[] {
    const result: HeadingItem[] = [];

    for (let i = 0; i < headings.length; i += 1) {
        const heading = headings[i];

        if (heading.id) {
            result.push({
                depth: parseInt(heading.getAttribute('data-order') || '0', 10),
                content: heading.getAttribute('data-heading') || '',
                id: heading.id,
                getNode: () => document.getElementById(heading.id),
            });
        }
    }

    return result;
}

export function getHeadings(selector: string): HeadingItem[] {
    const root = document.querySelector(selector);

    if (!root) {
        return [];
    }

    return getHeadingsData(Array.from(root.querySelectorAll('[data-heading]')));
}
