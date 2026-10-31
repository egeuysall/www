import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DitherShader } from "@/components/ui/dither-shader";
import "@/styles/photo-scroll.css";

type ScrollPhoto = {
  slug: string;
  title: string;
  story: string;
  displaySrc: string;
  fallbackSrc: string;
  ditherSrc: string;
  alt: string;
};

export default function PhotoScrollGallery({ photos }: { photos: ScrollPhoto[] }) {
  const [transitionIndex, setTransitionIndex] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef<HTMLElement[]>([]);
  const readyPhotosRef = useRef(new Set<string>());
  const updateRef = useRef<() => void>(() => {});
  const markDitherReady = useCallback((slug: string) => {
    readyPhotosRef.current.add(slug);
    updateRef.current();
  }, []);

  useEffect(() => {
    let frame = 0;
    let scrollEndTimer = 0;
    let previousTransition = -1;
    let previousActive = -1;
    let previousPreload = -1;
    const gallery = galleryRef.current;
    const imageStage = gallery?.querySelector<HTMLElement>(".photo-scroll-image-stage");
    const siteHeader = document.querySelector<HTMLElement>(".site-header");

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const firstSlide = slidesRef.current[0];
        if (!firstSlide || !gallery) return;

        const firstSlideTop = firstSlide.getBoundingClientRect().top + window.scrollY;
        const position = Math.max(0, (window.scrollY - firstSlideTop) / window.innerHeight);
        const boundedPosition = Math.min(position, photos.length - 1);
        const index = Math.floor(boundedPosition);
        const nextIndex = Math.min(index + 1, photos.length - 1);
        const ready = readyPhotosRef.current.has(photos[index]?.slug ?? "")
          && (nextIndex === index || readyPhotosRef.current.has(photos[nextIndex]?.slug ?? ""));
        const progress = ready ? boundedPosition - index : 0;
        const active = Math.min(Math.round(index + progress), photos.length - 1);

        if (index !== previousTransition) {
          previousTransition = index;
          flushSync(() => setTransitionIndex(index));
        }

        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const headerStyle = siteHeader ? getComputedStyle(siteHeader) : null;
        const headerContentWidth = siteHeader && headerStyle
          ? siteHeader.clientWidth - Number.parseFloat(headerStyle.paddingLeft) - Number.parseFloat(headerStyle.paddingRight)
          : rootFontSize * 34.75;
        const maxLayerWidth = Math.min(imageStage?.clientWidth ?? gallery.clientWidth, headerContentWidth);
        gallery.querySelectorAll<HTMLElement>(".photo-scroll-layer").forEach((layer) => {
          const image = layer.querySelector("img");
          if (!image || !imageStage) return;
          const imageWidth = image.naturalWidth || Number(image.getAttribute("width"));
          const imageHeight = image.naturalHeight || Number(image.getAttribute("height"));
          if (!imageWidth || !imageHeight) return;
          const scale = Math.min(imageStage.clientHeight / imageHeight, maxLayerWidth / imageWidth);
          layer.style.width = `${imageWidth * scale}px`;
          layer.style.height = `${imageHeight * scale}px`;
        });

        gallery.style.setProperty("--photo-outgoing-opacity", String(1 - progress));
        gallery.style.setProperty("--photo-outgoing-x", `${-0.1 * headerContentWidth * progress}px`);
        gallery.style.setProperty("--photo-outgoing-scale", String(1 - 0.22 * progress));
        gallery.style.setProperty("--photo-incoming-opacity", String(progress));
        gallery.style.setProperty("--photo-incoming-x", `${0.1 * headerContentWidth * (1 - progress)}px`);
        gallery.style.setProperty("--photo-incoming-scale", String(0.78 + 0.22 * progress));
        gallery.style.setProperty("--photo-outgoing-pointer-events", active === index ? "auto" : "none");
        gallery.style.setProperty("--photo-incoming-pointer-events", active === index + 1 ? "auto" : "none");

        const activeLayer = gallery.querySelector<HTMLElement>(
          active === index ? ".photo-scroll-layer.is-outgoing" : ".photo-scroll-layer.is-incoming",
        );
        if (activeLayer && storyRef.current) {
          storyRef.current.style.width = `${activeLayer.offsetWidth}px`;
          storyRef.current.style.removeProperty("transform");
        }

        if (active !== previousActive) {
          previousActive = active;
          setActiveIndex(active);
        }
        const preloadIndex = Math.min(index + 2, photos.length - 1);
        if (preloadIndex !== previousPreload) {
          previousPreload = preloadIndex;
          const image = new Image();
          image.src = photos[preloadIndex]?.displaySrc ?? "";
        }
      });
    };

    const handleScroll = () => {
      if (gallery) {
        gallery.classList.add("is-scrolling");
        gallery.querySelectorAll(".is-pointer-hovered").forEach((layer) => {
          layer.classList.remove("is-pointer-hovered");
        });
      }
      window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => gallery?.classList.remove("is-scrolling"), 140);
      update();
    };

    const layoutObserver = new ResizeObserver(() => update());
    if (imageStage) layoutObserver.observe(imageStage);
    if (siteHeader) layoutObserver.observe(siteHeader);

    updateRef.current = update;
    update();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(scrollEndTimer);
      layoutObserver.disconnect();
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", update);
    };
  }, [photos.length]);

  if (!photos.length) {
    return <p className="p-6 text-sm text-neutral-400">no photos available yet.</p>;
  }

  return (
    <div ref={galleryRef} className="photo-scroll-gallery">
      <div className="photo-scroll-stage" aria-live="polite">
        <div className="photo-scroll-image-stage">
          <PhotoLayer
            key={photos[transitionIndex]?.slug}
            photo={photos[transitionIndex]}
            state="outgoing"
            onDitherReady={markDitherReady}
            onImageLoad={() => updateRef.current()}
          />
          {photos[transitionIndex + 1] && (
            <PhotoLayer
              key={photos[transitionIndex + 1].slug}
              photo={photos[transitionIndex + 1]}
              state="incoming"
              onDitherReady={markDitherReady}
              onImageLoad={() => updateRef.current()}
            />
          )}
        </div>
        <div ref={storyRef} className="photo-scroll-story" aria-live="polite">
          {photos[activeIndex]?.story.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => (
            <p key={`${activeIndex}-${index}`}>{paragraph.trim()}</p>
          ))}
        </div>
      </div>

      <div className="photo-scroll-slides" aria-label="photo sequence">
        {photos.map((photo, index) => (
          <section
            key={photo.slug}
            ref={(node) => {
              if (node) slidesRef.current[index] = node;
            }}
            data-photo-index={index}
            className="photo-scroll-slide"
            aria-label={`${index + 1} of ${photos.length}: ${photo.title}`}
          />
        ))}
      </div>
    </div>
  );
}

function PhotoLayer({
  photo,
  state,
  onDitherReady,
  onImageLoad,
}: {
  photo: ScrollPhoto;
  state: "incoming" | "outgoing";
  onDitherReady: (slug: string) => void;
  onImageLoad: () => void;
}) {
  const [ditherReady, setDitherReady] = useState(false);
  const handleDitherReady = useCallback(() => {
    setDitherReady(true);
    onDitherReady(photo.slug);
  }, [onDitherReady, photo.slug]);

  return (
    <div
      data-dither-host
      className={`photo-scroll-layer is-${state}${ditherReady ? " is-ready" : ""}`}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse" && !event.currentTarget.closest(".photo-scroll-gallery.is-scrolling")) {
          event.currentTarget.classList.add("is-pointer-hovered");
        }
      }}
      onPointerLeave={(event) => event.currentTarget.classList.remove("is-pointer-hovered")}
    >
      <div className="photo-scroll-frame">
        <img
          src={photo.displaySrc}
          alt={photo.alt}
          width={1080}
          height={1350}
          loading="eager"
          decoding="async"
          onLoad={onImageLoad}
          onError={(event) => {
            const image = event.currentTarget;
            if (image.dataset.fallbackAttempted || !photo.fallbackSrc) return;
            image.dataset.fallbackAttempted = "true";
            image.src = photo.fallbackSrc;
          }}
        />
        <DitherShader
          src={photo.ditherSrc}
          objectFit="contain"
          processingWidth={240}
          maxResizeWidth={720}
          maxResizeHeight={900}
          threshold={0.56}
          brightness={-0.18}
          contrast={1.8}
          className="photo-scroll-dither pointer-events-none"
          onReady={handleDitherReady}
        />
      </div>
      <a
        className="photo-scroll-image-link"
        href={`/photo/${photo.slug}/`}
        aria-label={`Open photo story: ${photo.title}`}
      />
    </div>
  );
}
