// The photo picker for a page's image fields. Today it is the events tab's
// URL box + upload (/api/admin/media); it is wrapped here so a better picker
// can replace it for every page field by changing this one file.
import { ImageField } from '../events/ImageField';

export function PageImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  return <ImageField value={value} onChange={onChange} />;
}
