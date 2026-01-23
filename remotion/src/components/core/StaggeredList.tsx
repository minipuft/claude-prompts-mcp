import { Sequence } from "remotion";
import { stagger } from "../../constants";

type StaggeredListProps = {
  items: React.ReactNode[];
  start?: number;
  delay?: number;
};

export const StaggeredList: React.FC<StaggeredListProps> = ({
  items,
  start = 0,
  delay = stagger.base,
}) => {
  return (
    <>
      {items.map((item, index) => (
        <Sequence
          key={index}
          from={start + index * delay}
          durationInFrames={delay * 6}
          layout="none"
        >
          {item}
        </Sequence>
      ))}
    </>
  );
};
