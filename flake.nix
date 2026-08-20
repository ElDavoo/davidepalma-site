{
  description = "davidepalma.it - static site generator (WikiJS replacement)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            go
            # Runs the same Kroki images CI uses, rootless, for diagram previews
            # while authoring. See tools/kroki.sh.
            podman
            postgresql        # psql, for the one-shot WikiJS export
            apacheHttpd       # htpasswd
            git
          ];
          shellHook = ''
            echo "davidepalma-site dev shell: node $(node --version), go $(go version | cut -d' ' -f3)"
          '';
        };
      });
    };
}
