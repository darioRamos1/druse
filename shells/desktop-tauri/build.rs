fn main() {
    println!("cargo:rerun-if-env-changed=DRUSE_VARIANT");
    tauri_build::build()
}
