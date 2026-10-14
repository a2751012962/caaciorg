// The photo picker for a page's image fields: the console's shared
// ImagePicker (URL box, upload, crop and rotate before upload, re-crop of the
// current photo). Wrapped here so every page field changes in one place.
import { ImagePicker } from '../../media/ImagePicker';

export function PageImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  return <ImagePicker value={value} onChange={onChange} />;
}
