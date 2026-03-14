import { Canvas } from "@react-three/fiber";
import { type AvatarId } from "@chainatlas/shared";
import { SceneContent } from "./chain-atlas-scene/scene-content";

export function ChainAtlasScene({
  avatarId,
  displayName,
}: {
  avatarId?: AvatarId;
  displayName: string;
}) {
  return (
    <Canvas
      camera={{ far: 260, fov: 62, near: 0.4, position: [0, 9, -10] }}
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      shadows
    >
      <SceneContent avatarId={avatarId} displayName={displayName} />
    </Canvas>
  );
}
